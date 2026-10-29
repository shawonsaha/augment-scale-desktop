using System.Net;
using System.Data;
using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using AugmentScale.Data;
using AugmentScale.Models;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Services;

/// <summary>
/// Core synchronization and remote workstation control engine for Supabase Cloud.
/// Handles always-on heartbeats, remote control toggles (license, sync pause/resume, backup),
/// offline license grace period enforcement, one-time bootstrap, and reliable outbox streaming.
/// </summary>
public sealed class CloudControlService : IDisposable
{
    public const int MaxOutboxAttempts = 10;

    private static readonly HashSet<string> BooleanColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        "license_active", "enable_cloud_sync", "enable_cloud_backup", "trigger_immediate_backup",
        "is_active", "is_quick_pick", "is_overridden", "is_final", "checksum_valid", "is_stable", "is_reprint"
    };

    private static readonly HashSet<string> JsonColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        "before_values", "after_values"
    };

    /// <summary>
    /// Explicit static allowlist of tables permitted for dynamic querying
    /// (bootstrap reading and outbox entity row retrieval) to prevent SQL injection.
    /// </summary>
    internal static readonly HashSet<string> AllowedQueryTables = new(StringComparer.OrdinalIgnoreCase)
    {
        "organizations",
        "sites",
        "weighbridges",
        "scale_connection_profiles",
        "workstations",
        "profiles",
        "user_roles",
        "vehicles",
        "customers",
        "products",
        "drivers",
        "weigh_tickets",
        "weight_captures",
        "ticket_corrections",
        "print_jobs",
        "scale_health_events",
        "audit_events",
        "archive_runs",
    };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false,
    };

    private readonly DatabaseService _database;
    private readonly ConfigService _config;
    private readonly HttpClient _http;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _wakeSemaphore = new(0, 1);
    private readonly SemaphoreSlim _cycleGate = new(1, 1);
    private readonly object _stateGate = new();
    private readonly object _syncTriggerGate = new();
    private CancellationTokenSource? _debounceCts;

    private Task? _workerTask;
    private bool _disposed;

    public string Status { get; private set; } = "offline";
    public bool LicenseActive { get; private set; } = true;
    public bool CloudSyncEnabled { get; private set; } = true;
    public DateTimeOffset? LastHeartbeatAt { get; private set; }
    public DateTimeOffset? LastSyncAt { get; private set; }
    public string? LastError { get; private set; }

    /// <summary>Raised whenever cloud sync state or outbox status updates.</summary>
    public event Action<SyncStatusDto>? StatusChanged;

    /// <summary>Raised whenever cloud ticket sequence watermark advances.</summary>
    public event Action<long>? TicketSequenceSynchronized;

    public CloudControlService(DatabaseService database, ConfigService config, HttpClient? httpClient = null)
    {
        _database = database;
        _config = config;

        var handler = new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(15),
            ConnectTimeout = TimeSpan.FromSeconds(10),
        };

        _http = httpClient ?? new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(20),
        };

        // Instantly push outbox changes to cloud when new rows are enqueued
        _database.OutboxEnqueued += OnOutboxEnqueued;
    }

    private void OnOutboxEnqueued()
    {
        if (_disposed) return;
        lock (_syncTriggerGate)
        {
            _debounceCts?.Cancel();
            _debounceCts?.Dispose();
            _debounceCts = new CancellationTokenSource();
            var token = _debounceCts.Token;

            _ = Task.Run(async () =>
            {
                try
                {
                    // 50ms debounce allows the calling repository transaction to commit
                    await Task.Delay(50, token);
                    await SyncNowAsync();
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    AppLog.Warn($"Cloud: Immediate outbox trigger failed: {ex.Message}");
                }
            }, token);
        }
    }

    private void NotifyStatusChanged()
    {
        try
        {
            var status = _database.GetSyncStatus();
            StatusChanged?.Invoke(status);
        }
        catch { }
    }

    public void Start()
    {
        if (_workerTask != null) return;
        _workerTask = Task.Run(() => WorkerLoopAsync(_cts.Token));
        AppLog.Info("Cloud: Control service started in background.");
    }

    public async Task<SyncStatusDto> SyncNowAsync()
    {
        try
        {
            await RunCycleAsync(_cts.Token);
        }
        catch (Exception ex)
        {
            AppLog.Warn($"Cloud: Manual sync encountered issue: {ex.Message}");
        }

        return _database.GetSyncStatus();
    }

    public object GetCloudStatus()
    {
        lock (_stateGate)
        {
            return new
            {
                status = Status,
                licenseActive = LicenseActive,
                cloudSyncEnabled = CloudSyncEnabled,
                lastHeartbeatAt = LastHeartbeatAt?.ToString("O"),
                lastSyncAt = LastSyncAt?.ToString("O"),
                lastError = LastError,
                graceDaysRemaining = CalculateGraceDaysRemaining(),
            };
        }
    }

    private async Task WorkerLoopAsync(CancellationToken ct)
    {
        // First run on startup: small 1.5s delay to let UI paint first
        try
        {
            await Task.Delay(1500, ct);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await RunCycleAsync(ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                lock (_stateGate)
                {
                    LastError = ex.Message;
                    Status = "offline";
                }
                AppLog.Error("Cloud: Unexpected loop exception", ex);
            }

            var intervalSeconds = Math.Max(10, _config.Setup.Cloud.HeartbeatIntervalSeconds);
            try
            {
                // Wait for either the hourly interval or an immediate trigger from SyncNowAsync
                await _wakeSemaphore.WaitAsync(TimeSpan.FromSeconds(intervalSeconds), ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RunCycleAsync(CancellationToken ct)
    {
        if (!await _cycleGate.WaitAsync(0, ct))
        {
            // Another cycle is already running; signal semaphore so it cycles again if pending
            try
            {
                if (_wakeSemaphore.CurrentCount == 0) _wakeSemaphore.Release();
            }
            catch { }
            return;
        }

        try
        {
            _database.EnsureInitialized();

            var cloudConfig = _config.Setup.Cloud;
            if (string.IsNullOrWhiteSpace(cloudConfig.SupabaseUrl) || string.IsNullOrWhiteSpace(cloudConfig.SupabaseAnonKey))
            {
                lock (_stateGate)
                {
                    Status = "offline";
                    LastError = "Supabase configuration is missing.";
                }
                return;
            }

            var baseUrl = cloudConfig.SupabaseUrl.TrimEnd('/');
            var apiKey = cloudConfig.SupabaseAnonKey.Trim();

            // Step 1: Heartbeat & Remote Controls
            var controlsSuccess = await ProcessWorkstationControlsAsync(baseUrl, apiKey, ct);

            // Step 1.5: Synchronize cloud ticket watermark before bootstrap or outbox streaming
            if (controlsSuccess)
            {
                await SyncCloudTicketWatermarkAsync(baseUrl, apiKey, ct);
            }

            // Step 2: Bootstrap if controls succeeded & bootstrap pending
            if (controlsSuccess && LicenseActive)
            {
                await EnsureReferenceBootstrapAsync(baseUrl, apiKey, ct);
            }

            // Step 3: Stream pending outbox events if sync is enabled
            if (controlsSuccess && LicenseActive && CloudSyncEnabled)
            {
                EnsurePendingEntityBackfill();
                await StreamOutboxEventsAsync(baseUrl, apiKey, ct);
            }
            else if (!CloudSyncEnabled)
            {
                lock (_stateGate)
                {
                    Status = "paused";
                }
                UpdateLocalCursorCloudStatus("paused");
            }
        }
        finally
        {
            _cycleGate.Release();
            NotifyStatusChanged();
        }
    }

    private async Task<bool> ProcessWorkstationControlsAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        var workstationId = _database.WorkstationId;
        var orgId = _database.OrganizationId;
        var hostname = Environment.MachineName;

        int pendingCount = GetPendingOutboxCount();

        try
        {
            var requestUrl = $"{baseUrl}/rest/v1/workstation_controls?workstation_id=eq.{Uri.EscapeDataString(workstationId)}&select=*";
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
            AddSupabaseHeaders(request, apiKey);

            using var response = await _http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var errorText = await response.Content.ReadAsStringAsync(ct);
                HandleControlsFailure($"Supabase returned {response.StatusCode}: {errorText}");
                return false;
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            bool licenseActive = true;
            string? licenseExpiresAt = null;
            string? minAppVersion = "1.0.0";
            bool enableCloudSync = true;
            bool enableCloudBackup = false;
            bool triggerImmediateBackup = false;

            if (root.ValueKind == JsonValueKind.Array && root.GetArrayLength() > 0)
            {
                var row = root[0];
                if (row.TryGetProperty("license_active", out var licProp))
                    licenseActive = licProp.GetBoolean();
                if (row.TryGetProperty("license_expires_at", out var licExpProp) && licExpProp.ValueKind != JsonValueKind.Null)
                    licenseExpiresAt = licExpProp.GetString();
                if (row.TryGetProperty("min_app_version", out var minVerProp) && minVerProp.ValueKind != JsonValueKind.Null)
                    minAppVersion = minVerProp.GetString();
                if (row.TryGetProperty("enable_cloud_sync", out var syncProp))
                    enableCloudSync = syncProp.GetBoolean();
                if (row.TryGetProperty("enable_cloud_backup", out var bkpProp))
                    enableCloudBackup = bkpProp.GetBoolean();
                if (row.TryGetProperty("trigger_immediate_backup", out var trigProp))
                    triggerImmediateBackup = trigProp.GetBoolean();

                // Send heartbeat PATCH
                await SendHeartbeatPatchAsync(baseUrl, apiKey, workstationId, pendingCount, ct);

                if (triggerImmediateBackup)
                {
                    await HandleRemoteBackupTriggerAsync(baseUrl, apiKey, workstationId, ct);
                }
            }
            else
            {
                // Register workstation row
                await RegisterWorkstationControlAsync(baseUrl, apiKey, workstationId, orgId, hostname, pendingCount, ct);
            }

            // Update local SQLite license cache & status
            var nowStr = DateTimeOffset.UtcNow.ToString("O");
            SaveLicenseCache(licenseActive, licenseExpiresAt, minAppVersion, enableCloudSync, enableCloudBackup, triggerImmediateBackup, nowStr);

            lock (_stateGate)
            {
                LicenseActive = licenseActive;
                CloudSyncEnabled = enableCloudSync;
                LastHeartbeatAt = DateTimeOffset.UtcNow;
                Status = enableCloudSync ? "online" : "paused";
                LastError = null;
            }

            UpdateLocalCursorCloudStatus(Status);
            AppLog.Info($"Cloud: Controls read OK — license={licenseActive}, sync={enableCloudSync}");
            return true;
        }
        catch (Exception ex)
        {
            HandleControlsFailure(ex.Message);
            return false;
        }
    }

    private async Task SendHeartbeatPatchAsync(string baseUrl, string apiKey, string workstationId, int pendingCount, CancellationToken ct)
    {
        var patchUrl = $"{baseUrl}/rest/v1/workstation_controls?workstation_id=eq.{Uri.EscapeDataString(workstationId)}";
        using var patchRequest = new HttpRequestMessage(HttpMethod.Patch, patchUrl);
        AddSupabaseHeaders(patchRequest, apiKey);
        patchRequest.Headers.Add("Prefer", "return=minimal");

        var payload = new
        {
            last_heartbeat_at = DateTimeOffset.UtcNow.ToString("O"),
            app_version = "1.0.0",
            hostname = Environment.MachineName,
            outbox_pending_count = pendingCount,
        };

        patchRequest.Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json");
        using var patchResp = await _http.SendAsync(patchRequest, ct);
        if (!patchResp.IsSuccessStatusCode)
        {
            var err = await patchResp.Content.ReadAsStringAsync(ct);
            AppLog.Warn($"Cloud: Heartbeat PATCH returned {patchResp.StatusCode}: {err}");
        }
    }

    private async Task RegisterWorkstationControlAsync(string baseUrl, string apiKey, string workstationId, string orgId, string hostname, int pendingCount, CancellationToken ct)
    {
        var postUrl = $"{baseUrl}/rest/v1/workstation_controls";
        using var postRequest = new HttpRequestMessage(HttpMethod.Post, postUrl);
        AddSupabaseHeaders(postRequest, apiKey);
        postRequest.Headers.Add("Prefer", "resolution=merge-duplicates,return=minimal");

        var payload = new
        {
            workstation_id = workstationId,
            organization_id = orgId,
            hostname = hostname,
            license_active = true,
            enable_cloud_sync = true,
            enable_cloud_backup = false,
            app_version = "1.0.0",
            last_startup_at = DateTimeOffset.UtcNow.ToString("O"),
            last_heartbeat_at = DateTimeOffset.UtcNow.ToString("O"),
            outbox_pending_count = pendingCount,
        };

        postRequest.Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json");
        using var postResp = await _http.SendAsync(postRequest, ct);
        if (!postResp.IsSuccessStatusCode)
        {
            var err = await postResp.Content.ReadAsStringAsync(ct);
            AppLog.Warn($"Cloud: Register workstation_controls returned {postResp.StatusCode}: {err}");
        }
    }

    private async Task HandleRemoteBackupTriggerAsync(string baseUrl, string apiKey, string workstationId, CancellationToken ct)
    {
        AppLog.Info("Cloud: Superadmin requested immediate backup trigger. Executing archive check...");
        try
        {
            _database.RecordScaleHealth("remote_command", "Immediate cloud backup command received from superadmin.");
            _database.ArchiveRuns.RetryFailed(DateTimeOffset.Now);
        }
        catch (Exception ex)
        {
            AppLog.Error("Cloud: Immediate backup trigger handling error", ex);
        }

        // Clear flag
        var patchUrl = $"{baseUrl}/rest/v1/workstation_controls?workstation_id=eq.{Uri.EscapeDataString(workstationId)}";
        using var clearRequest = new HttpRequestMessage(HttpMethod.Patch, patchUrl);
        AddSupabaseHeaders(clearRequest, apiKey);
        clearRequest.Headers.Add("Prefer", "return=minimal");
        clearRequest.Content = new StringContent("{\"trigger_immediate_backup\":false}", Encoding.UTF8, "application/json");
        using var clearResp = await _http.SendAsync(clearRequest, ct);
    }

    private void HandleControlsFailure(string reason)
    {
        lock (_stateGate)
        {
            LastError = reason;
            Status = "offline";
        }

        // Apply offline grace period check from local SQLite cache
        using var conn = _database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT license_active, enable_cloud_sync, last_cloud_success_at FROM license_cache WHERE id = 'current';";

        bool cachedLicense = true;
        bool cachedSync = true;
        DateTimeOffset? lastSuccess = null;

        using (var reader = cmd.ExecuteReader())
        {
            if (reader.Read())
            {
                cachedLicense = reader.GetInt32(0) == 1;
                cachedSync = reader.GetInt32(1) == 1;
                if (!reader.IsDBNull(2) && DateTimeOffset.TryParse(reader.GetString(2), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dt))
                {
                    lastSuccess = dt;
                }
            }
        }

        var graceDays = _config.Setup.Cloud.LicenseGraceDays;
        bool inGracePeriod = true;

        if (lastSuccess.HasValue)
        {
            var elapsed = (DateTimeOffset.UtcNow - lastSuccess.Value).TotalDays;
            if (elapsed > graceDays)
            {
                inGracePeriod = false;
                AppLog.Error($"Cloud: Offline license grace period expired ({elapsed:F1} days > {graceDays} days).");
            }
            else
            {
                AppLog.Warn($"Cloud: Offline — within {graceDays}-day grace period ({elapsed:F1} days elapsed).");
            }
        }
        else
        {
            AppLog.Warn("Cloud: Offline — no prior cloud check recorded; operating on first-run grace.");
        }

        lock (_stateGate)
        {
            LicenseActive = inGracePeriod && cachedLicense;
            CloudSyncEnabled = cachedSync;
        }

        using var update = conn.CreateCommand();
        update.CommandText = "UPDATE license_cache SET last_cloud_check_at = $now WHERE id = 'current';";
        update.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        update.ExecuteNonQuery();

        UpdateLocalCursorCloudStatus("offline");
    }

    private void SaveLicenseCache(bool licenseActive, string? expiresAt, string? minVersion, bool syncEnabled, bool backupEnabled, bool backupNow, string nowStr)
    {
        using var conn = _database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO license_cache (
                id, license_active, license_expires_at, min_app_version,
                enable_cloud_sync, enable_cloud_backup, trigger_immediate_backup,
                last_cloud_check_at, last_cloud_success_at, cached_at
            ) VALUES (
                'current', $active, $expires, $minVer,
                $sync, $backup, $backupNow,
                $now, $now, $now
            )
            ON CONFLICT(id) DO UPDATE SET
                license_active = excluded.license_active,
                license_expires_at = excluded.license_expires_at,
                min_app_version = excluded.min_app_version,
                enable_cloud_sync = excluded.enable_cloud_sync,
                enable_cloud_backup = excluded.enable_cloud_backup,
                trigger_immediate_backup = excluded.trigger_immediate_backup,
                last_cloud_check_at = excluded.last_cloud_check_at,
                last_cloud_success_at = excluded.last_cloud_success_at,
                cached_at = excluded.cached_at;
            """;
        cmd.Parameters.AddWithValue("$active", licenseActive ? 1 : 0);
        cmd.Parameters.AddWithValue("$expires", (object?)expiresAt ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$minVer", (object?)minVersion ?? "1.0.0");
        cmd.Parameters.AddWithValue("$sync", syncEnabled ? 1 : 0);
        cmd.Parameters.AddWithValue("$backup", backupEnabled ? 1 : 0);
        cmd.Parameters.AddWithValue("$backupNow", backupNow ? 1 : 0);
        cmd.Parameters.AddWithValue("$now", nowStr);
        cmd.ExecuteNonQuery();
    }

    private void EnsurePendingEntityBackfill()
    {
        try
        {
            using var conn = _database.OpenConnection();
            using var txn = conn.BeginTransaction();
            using var cmd = conn.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = """
                SELECT id, ticket_id, organization_id, correction_type, field_changed,
                       old_value, new_value, reason, requested_by, requested_at,
                       approved_by, approved_at, approval_status, created_at
                FROM ticket_corrections
                WHERE id NOT IN (
                    SELECT entity_id FROM outbox_events WHERE entity_type = 'ticket_corrections'
                );
                """;

            var toEnqueue = new List<(string Id, Dictionary<string, object?> Row)>();
            using (var reader = cmd.ExecuteReader())
            {
                while (reader.Read())
                {
                    toEnqueue.Add((reader.GetString(0), RowToDictionary(reader)));
                }
            }

            if (toEnqueue.Count > 0)
            {
                AppLog.Info($"Cloud: Backfilling {toEnqueue.Count} un-queued ticket_corrections to outbox...");
                foreach (var item in toEnqueue)
                {
                    var reqBy = item.Row.TryGetValue("requested_by", out var rb) ? rb?.ToString() : null;
                    var rsn = item.Row.TryGetValue("reason", out var r) ? r?.ToString() : null;
                    _database.InsertOutbox(conn, txn, "ticket_corrections", item.Id, "insert", item.Row, reqBy ?? "system", rsn);
                }
                AppLog.Info($"Cloud: Successfully enqueued {toEnqueue.Count} ticket_corrections to outbox.");
            }

            // 2. Backfill un-queued or locally updated vehicles
            using (var vehCmd = conn.CreateCommand())
            {
                vehCmd.Transaction = txn;
                vehCmd.CommandText = """
                    SELECT v.*
                    FROM vehicles v
                    LEFT JOIN (
                        SELECT entity_id, MAX(created_at) as max_outbox_at
                        FROM outbox_events
                        WHERE entity_type = 'vehicles'
                        GROUP BY entity_id
                    ) o ON v.id = o.entity_id
                    WHERE o.entity_id IS NULL OR v.updated_at > o.max_outbox_at;
                    """;

                var vehiclesToEnqueue = new List<(string Id, Dictionary<string, object?> Row)>();
                using (var reader = vehCmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        vehiclesToEnqueue.Add((reader.GetString(reader.GetOrdinal("id")), RowToDictionary(reader)));
                    }
                }

                if (vehiclesToEnqueue.Count > 0)
                {
                    AppLog.Info($"Cloud: Backfilling {vehiclesToEnqueue.Count} un-queued vehicles to outbox...");
                    foreach (var item in vehiclesToEnqueue)
                    {
                        var updatedBy = item.Row.TryGetValue("updated_by", out var ub) ? ub?.ToString() : null;
                        _database.InsertOutbox(conn, txn, "vehicles", item.Id, "update", item.Row, updatedBy ?? "system");
                    }
                    AppLog.Info($"Cloud: Successfully enqueued {vehiclesToEnqueue.Count} vehicles to outbox.");
                }
            }

            txn.Commit();
        }
        catch (Exception ex)
        {
            AppLog.Warn($"Cloud: Error checking entity backfill: {ex.Message}");
        }
    }

    private async Task EnsureReferenceBootstrapAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        bool bootstrapCompleted = false;
        using (var conn = _database.OpenConnection())
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT bootstrap_completed FROM license_cache WHERE id = 'current';";
            var result = cmd.ExecuteScalar();
            if (result != null && Convert.ToInt32(result, CultureInfo.InvariantCulture) == 1)
            {
                bootstrapCompleted = true;
            }
        }

        if (bootstrapCompleted) return;

        AppLog.Info("Cloud: Starting one-time reference tables bootstrap...");

        var referenceTables = new[]
        {
            "organizations",
            "sites",
            "weighbridges",
            "scale_connection_profiles",
            "workstations",
            "profiles",
            "user_roles",
            "vehicles",
            "customers",
            "products",
            "drivers",
            "ticket_corrections",
        };

        foreach (var table in referenceTables)
        {
            ct.ThrowIfCancellationRequested();
            var rows = ReadAllRowsFromTable(table);
            if (rows.Count == 0) continue;

            var upsertUrl = $"{baseUrl}/rest/v1/{table}";
            using var req = new HttpRequestMessage(HttpMethod.Post, upsertUrl);
            AddSupabaseHeaders(req, apiKey);
            req.Headers.Add("Prefer", "resolution=merge-duplicates,return=minimal");

            var jsonContent = JsonSerializer.Serialize(rows, JsonOptions);
            req.Content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var err = await resp.Content.ReadAsStringAsync(ct);
                AppLog.Warn($"Cloud: Bootstrap table '{table}' failed ({resp.StatusCode}): {err}");
                return; // Try again next cycle
            }
        }

        using (var conn = _database.OpenConnection())
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE license_cache SET bootstrap_completed = 1 WHERE id = 'current';";
            cmd.ExecuteNonQuery();
        }

        AppLog.Info("Cloud: One-time reference tables bootstrap completed successfully.");
    }

    private async Task StreamOutboxEventsAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        lock (_stateGate)
        {
            Status = "syncing";
        }
        UpdateLocalCursorCloudStatus("syncing");

        while (!ct.IsCancellationRequested)
        {
            var batch = FetchPendingOutboxBatch(50);
            if (batch.Count == 0)
            {
                break;
            }

            AppLog.Info($"Cloud: Streaming {batch.Count} outbox events to Supabase...");
            var hasFailure = false;

            foreach (var evt in batch)
            {
                ct.ThrowIfCancellationRequested();

                var entityType = evt.EntityType.Trim().ToLowerInvariant();
                var success = false;
                string? errorMessage = null;

                try
                {
                    if (!AllowedQueryTables.Contains(entityType))
                    {
                        throw new ArgumentException($"Disallowed or unrecognized entity type '{evt.EntityType}' in outbox event #{evt.Sequence}.");
                    }

                    if (evt.Operation == "delete")
                    {
                        // Check if row has soft delete in SQLite
                        var rowData = ReadRowById(entityType, evt.EntityId);
                        if (rowData != null)
                        {
                            var upsertRes = await UpsertRowToSupabaseAsync(baseUrl, apiKey, entityType, rowData, ct);
                            success = upsertRes.Success;
                            if (!success) errorMessage = upsertRes.ErrorMessage;
                        }
                        else
                        {
                            // Hard delete in Supabase
                            var deleteUrl = $"{baseUrl}/rest/v1/{entityType}?id=eq.{Uri.EscapeDataString(evt.EntityId)}";
                            using var delReq = new HttpRequestMessage(HttpMethod.Delete, deleteUrl);
                            AddSupabaseHeaders(delReq, apiKey);
                            delReq.Headers.Add("Prefer", "return=minimal");
                            using var delResp = await _http.SendAsync(delReq, ct);
                            success = delResp.IsSuccessStatusCode;
                            if (!success)
                                errorMessage = await delResp.Content.ReadAsStringAsync(ct);
                        }
                    }
                    else
                    {
                        // Read authoritative row directly from SQLite table
                        var rowData = ReadRowById(entityType, evt.EntityId);
                        if (rowData != null)
                        {
                            var upsertRes = await UpsertRowToSupabaseAsync(baseUrl, apiKey, entityType, rowData, ct);
                            success = upsertRes.Success;
                            if (!success) errorMessage = upsertRes.ErrorMessage;

                            if (!success && entityType == "weigh_tickets" && errorMessage != null && errorMessage.Contains("idx_tickets_number"))
                            {
                                AppLog.Warn($"Cloud: Conflict on idx_tickets_number detected for ticket {evt.EntityId}. Auto-resolving ticket number...");
                                var cloudMax = await FetchCloudMaxTicketNumberAsync(baseUrl, apiKey, ct);
                                long currentNum = 0;
                                if (rowData.TryGetValue("ticket_number", out var numObj) && numObj != null)
                                {
                                    currentNum = Convert.ToInt64(numObj, CultureInfo.InvariantCulture);
                                }

                                var newTicketNumber = Math.Max(cloudMax ?? 0, currentNum) + 1;
                                RenumberLocalTicket(evt.EntityId, newTicketNumber);

                                rowData["ticket_number"] = newTicketNumber;
                                rowData["ticket_display_id"] = newTicketNumber.ToString(CultureInfo.InvariantCulture);
                                UpdateOutboxEventPayload(evt.Id, rowData);

                                upsertRes = await UpsertRowToSupabaseAsync(baseUrl, apiKey, entityType, rowData, ct);
                                if (upsertRes.Success)
                                {
                                    AppLog.Info($"Cloud: Successfully healed ticket {evt.EntityId} with #{newTicketNumber} and synced to Supabase.");
                                    success = true;
                                    errorMessage = null;
                                }
                                else
                                {
                                    success = false;
                                    errorMessage = upsertRes.ErrorMessage;
                                }
                            }
                        }
                        else
                        {
                            // Entity no longer exists in SQLite (was hard deleted or purged).
                            // Ensure Supabase also cleans it up and mark obsolete event accepted.
                            AppLog.Info($"Cloud: Entity {entityType}/{evt.EntityId} no longer in SQLite; skipping obsolete {evt.Operation} event #{evt.Sequence}.");
                            var deleteUrl = $"{baseUrl}/rest/v1/{entityType}?id=eq.{Uri.EscapeDataString(evt.EntityId)}";
                            using var delReq = new HttpRequestMessage(HttpMethod.Delete, deleteUrl);
                            AddSupabaseHeaders(delReq, apiKey);
                            delReq.Headers.Add("Prefer", "return=minimal");
                            using var delResp = await _http.SendAsync(delReq, ct);
                            success = true;
                        }
                    }
                }
                catch (Exception ex)
                {
                    success = false;
                    errorMessage = ex.Message;
                }

                var nowStr = DateTimeOffset.UtcNow.ToString("O");
                if (success)
                {
                    MarkOutboxAccepted(evt.Id, evt.Sequence, nowStr);
                    lock (_stateGate)
                    {
                        LastSyncAt = DateTimeOffset.UtcNow;
                    }
                }
                else
                {
                    var deadLettered = MarkOutboxFailed(evt.Id, evt.Attempts, errorMessage ?? "HTTP error", nowStr);
                    if (deadLettered)
                    {
                        AppLog.Error($"Cloud: Outbox event #{evt.Sequence} ({evt.EntityType}) reached max retry attempts ({MaxOutboxAttempts}) and transitioned to 'dead_letter': {errorMessage}");
                    }
                    else
                    {
                        AppLog.Warn($"Cloud: Outbox event #{evt.Sequence} ({evt.EntityType}) attempt {evt.Attempts + 1}/{MaxOutboxAttempts} failed: {errorMessage}");
                        hasFailure = true;
                        break;
                    }
                }
            }

            if (hasFailure)
            {
                break;
            }
        }

        lock (_stateGate)
        {
            Status = "online";
        }
        UpdateLocalCursorCloudStatus("online");
    }

    private async Task<(bool Success, HttpStatusCode StatusCode, string? ErrorMessage)> UpsertRowToSupabaseAsync(string baseUrl, string apiKey, string entityType, Dictionary<string, object?> rowData, CancellationToken ct)
    {
        var url = $"{baseUrl}/rest/v1/{entityType}";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        AddSupabaseHeaders(req, apiKey);
        req.Headers.Add("Prefer", "resolution=merge-duplicates,return=minimal");

        var json = JsonSerializer.Serialize(rowData, JsonOptions);
        req.Content = new StringContent(json, Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            AppLog.Warn($"Cloud: Upsert to '{entityType}' returned {resp.StatusCode}: {err}");
            return (false, resp.StatusCode, err);
        }

        return (true, resp.StatusCode, null);
    }

    internal async Task<long?> FetchCloudMaxTicketNumberAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        try
        {
            var orgId = _database.OrganizationId;
            var url = $"{baseUrl}/rest/v1/weigh_tickets?organization_id=eq.{Uri.EscapeDataString(orgId)}&select=ticket_number&order=ticket_number.desc&limit=1";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            AddSupabaseHeaders(req, apiKey);

            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var err = await resp.Content.ReadAsStringAsync(ct);
                AppLog.Warn($"Cloud: Failed to fetch max ticket number ({resp.StatusCode}): {err}");
                return null;
            }

            var json = await resp.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() > 0)
            {
                var first = doc.RootElement[0];
                if (first.TryGetProperty("ticket_number", out var numProp) && numProp.TryGetInt64(out var num))
                {
                    return num;
                }
            }

            return 0;
        }
        catch (Exception ex)
        {
            AppLog.Warn($"Cloud: Error fetching max ticket number: {ex.Message}");
            return null;
        }
    }

    internal async Task<bool> SyncCloudTicketWatermarkAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        var cloudMax = await FetchCloudMaxTicketNumberAsync(baseUrl, apiKey, ct);
        if (!cloudMax.HasValue || cloudMax.Value <= 0)
        {
            return false;
        }

        long previousWatermark = 0;
        using (var conn = _database.OpenConnection())
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT last_allocated_ticket_number FROM sync_cursors WHERE id = 'local';";
            var result = cmd.ExecuteScalar();
            if (result != null && result != DBNull.Value)
            {
                previousWatermark = Convert.ToInt64(result, CultureInfo.InvariantCulture);
            }

            if (cloudMax.Value > previousWatermark)
            {
                using var updateCmd = conn.CreateCommand();
                updateCmd.CommandText = """
                    UPDATE sync_cursors
                    SET last_allocated_ticket_number = $num
                    WHERE id = 'local' AND last_allocated_ticket_number < $num;
                    """;
                updateCmd.Parameters.AddWithValue("$num", cloudMax.Value);
                updateCmd.ExecuteNonQuery();

                AppLog.Info($"Cloud: Synchronized ticket watermark from {previousWatermark} to {cloudMax.Value}.");
                TicketSequenceSynchronized?.Invoke(cloudMax.Value);
                return true;
            }
        }

        return false;
    }

    private void RenumberLocalTicket(string ticketId, long newNumber)
    {
        using var conn = _database.OpenConnection();
        using var txn = conn.BeginTransaction();
        var now = DateTimeOffset.UtcNow.ToString("O");

        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = txn;
            cmd.CommandText = """
                UPDATE weigh_tickets
                SET ticket_number = $num,
                    ticket_display_id = $display,
                    updated_at = $now
                WHERE id = $id;
                """;
            cmd.Parameters.AddWithValue("$num", newNumber);
            cmd.Parameters.AddWithValue("$display", newNumber.ToString(CultureInfo.InvariantCulture));
            cmd.Parameters.AddWithValue("$now", now);
            cmd.Parameters.AddWithValue("$id", ticketId);
            cmd.ExecuteNonQuery();
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = txn;
            cmd.CommandText = """
                UPDATE sync_cursors
                SET last_allocated_ticket_number = $num
                WHERE id = 'local' AND last_allocated_ticket_number < $num;
                """;
            cmd.Parameters.AddWithValue("$num", newNumber);
            cmd.ExecuteNonQuery();
        }

        txn.Commit();
        TicketSequenceSynchronized?.Invoke(newNumber);
    }

    private void UpdateOutboxEventPayload(string outboxId, Dictionary<string, object?> rowData)
    {
        using var conn = _database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE outbox_events SET payload = $payload WHERE id = $id;";
        cmd.Parameters.AddWithValue("$payload", JsonSerializer.Serialize(rowData, JsonDefaults.CamelCase));
        cmd.Parameters.AddWithValue("$id", outboxId);
        cmd.ExecuteNonQuery();
    }

    internal List<Dictionary<string, object?>> ReadAllRowsFromTable(string table)
    {
        if (!AllowedQueryTables.Contains(table))
        {
            throw new ArgumentException($"Table '{table}' is not permitted for query execution.", nameof(table));
        }

        var list = new List<Dictionary<string, object?>>();
        using var conn = _database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT * FROM {table};";

        try
        {
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(RowToDictionary(reader));
            }
        }
        catch (SqliteException ex)
        {
            AppLog.Warn($"Cloud: Could not read table '{table}': {ex.Message}");
        }

        return list;
    }

    internal Dictionary<string, object?>? ReadRowById(string table, string id)
    {
        if (!AllowedQueryTables.Contains(table))
        {
            throw new ArgumentException($"Table '{table}' is not permitted for query execution.", nameof(table));
        }

        using var conn = _database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT * FROM {table} WHERE id = $id LIMIT 1;";
        cmd.Parameters.AddWithValue("$id", id);

        try
        {
            using var reader = cmd.ExecuteReader();
            if (reader.Read())
            {
                return RowToDictionary(reader);
            }
        }
        catch (SqliteException)
        {
            // Table might not exist or differ
        }

        return null;
    }

    private static Dictionary<string, object?> RowToDictionary(SqliteDataReader reader)
    {
        var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < reader.FieldCount; i++)
        {
            var colName = reader.GetName(i);
            if (reader.IsDBNull(i))
            {
                row[colName] = null;
            }
            else if (BooleanColumns.Contains(colName))
            {
                var val = reader.GetValue(i);
                row[colName] = val switch
                {
                    bool b => b,
                    long l => l != 0,
                    int n => n != 0,
                    string s => s is "1" or "true" or "True",
                    _ => Convert.ToInt64(val, CultureInfo.InvariantCulture) != 0,
                };
            }
            else if (JsonColumns.Contains(colName))
            {
                var jsonStr = reader.GetString(i);
                try
                {
                    using var doc = JsonDocument.Parse(jsonStr);
                    row[colName] = doc.RootElement.Clone();
                }
                catch
                {
                    row[colName] = jsonStr;
                }
            }
            else
            {
                row[colName] = reader.GetValue(i);
            }
        }
        return row;
    }

    private List<OutboxEventRecord> FetchPendingOutboxBatch(int limit)
    {
        var list = new List<OutboxEventRecord>();
        using var conn = _database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT id, sequence, entity_type, entity_id, operation, payload, attempts
            FROM outbox_events
            WHERE status = 'pending'
            ORDER BY sequence ASC
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$limit", limit);

        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            list.Add(new OutboxEventRecord(
                reader.GetString(0),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetInt32(6)));
        }

        return list;
    }

    private void MarkOutboxAccepted(string id, int sequence, string nowStr)
    {
        using var conn = _database.OpenConnection();
        using var txn = conn.BeginTransaction();

        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = txn;
            cmd.CommandText = "UPDATE outbox_events SET status = 'accepted', server_response = 'OK', last_attempt_at = $now WHERE id = $id;";
            cmd.Parameters.AddWithValue("$now", nowStr);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.Transaction = txn;
            cmd.CommandText = """
                UPDATE sync_cursors
                SET last_cloud_sync_at = $now, last_cloud_sequence = $seq, cloud_status = 'online'
                WHERE id = 'local';
                """;
            cmd.Parameters.AddWithValue("$now", nowStr);
            cmd.Parameters.AddWithValue("$seq", sequence);
            cmd.ExecuteNonQuery();
        }

        txn.Commit();
    }

    private bool MarkOutboxFailed(string id, int currentAttempts, string error, string nowStr)
    {
        var newAttempts = currentAttempts + 1;
        var deadLettered = newAttempts >= MaxOutboxAttempts;
        var newStatus = deadLettered ? "dead_letter" : "pending";

        using var conn = _database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            UPDATE outbox_events
            SET status = $status, attempts = $attempts, last_attempt_at = $now, server_response = $err
            WHERE id = $id;
            """;
        cmd.Parameters.AddWithValue("$status", newStatus);
        cmd.Parameters.AddWithValue("$attempts", newAttempts);
        cmd.Parameters.AddWithValue("$now", nowStr);
        cmd.Parameters.AddWithValue("$err", error.Length > 300 ? error[..300] : error);
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();

        return deadLettered;
    }

    private int GetPendingOutboxCount()
    {
        using var conn = _database.OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE status = 'pending';";
        return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private void UpdateLocalCursorCloudStatus(string status)
    {
        try
        {
            using var conn = _database.OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE sync_cursors SET cloud_status = $status WHERE id = 'local';";
            cmd.Parameters.AddWithValue("$status", status);
            cmd.ExecuteNonQuery();
        }
        catch
        {
            // Best effort
        }
    }

    private int? CalculateGraceDaysRemaining()
    {
        try
        {
            using var conn = _database.OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT last_cloud_success_at FROM license_cache WHERE id = 'current';";
            var val = cmd.ExecuteScalar() as string;
            if (!string.IsNullOrWhiteSpace(val) && DateTimeOffset.TryParse(val, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var last))
            {
                var daysElapsed = (DateTimeOffset.UtcNow - last).TotalDays;
                var remaining = _config.Setup.Cloud.LicenseGraceDays - (int)daysElapsed;
                return Math.Max(0, remaining);
            }
        }
        catch
        {
            // Ignore
        }
        return _config.Setup.Cloud.LicenseGraceDays;
    }

    private static void AddSupabaseHeaders(HttpRequestMessage request, string apiKey)
    {
        request.Headers.Add("apikey", apiKey);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _database.OutboxEnqueued -= OnOutboxEnqueued;
        _debounceCts?.Cancel();
        _debounceCts?.Dispose();

        _cts.Cancel();
        try { _wakeSemaphore.Release(); } catch { }

        try
        {
            _workerTask?.Wait(TimeSpan.FromSeconds(2));
        }
        catch
        {
            // Ignore cancel exceptions during shutdown
        }

        _wakeSemaphore.Dispose();
        _cycleGate.Dispose();
        _cts.Dispose();
        _http.Dispose();
    }

    private sealed record OutboxEventRecord(string Id, int Sequence, string EntityType, string EntityId, string Operation, string Payload, int Attempts);
}
