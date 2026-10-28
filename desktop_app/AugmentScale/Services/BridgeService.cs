using System.Text.Json;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using Microsoft.Web.WebView2.Core;

namespace AugmentScale.Services;

/// <summary>
/// Routes WebView2 postMessage commands to the database and pushes live scale
/// readings into the UI. One instance per window.
/// </summary>
public sealed class BridgeService
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private static readonly TimeSpan ProfileAdminSessionLifetime = TimeSpan.FromMinutes(15);

    private readonly DatabaseService _database;
    private readonly ScaleReaderService _scale;
    private readonly object _gate = new();
    private readonly object _adminGate = new();

    private CoreWebView2? _webView;
    private SynchronizationContext? _uiContext;
    private int _weightPushInFlight;
    private int _statusPushInFlight;
    private WeightReading? _capturedReading;
    private string? _profileAdminToken;
    private ProfileDto? _profileAdminActor;
    private DateTimeOffset _profileAdminExpiresAt;

    /// <summary>Raised when the web UI signals that its first screen is interactive.</summary>
    public event Action? UiReady;

    /// <summary>Raised when the web UI requests a title bar theme change (e.g. "dark" or "light").</summary>
    public event Action<string>? ThemeChanged;

    public PdfArchiveService? Archive { get; set; }
    private CloudControlService? _cloud;
    public CloudControlService? Cloud
    {
        get => _cloud;
        set
        {
            if (_cloud is not null)
            {
                _cloud.StatusChanged -= OnCloudStatusChanged;
            }
            _cloud = value;
            if (_cloud is not null)
            {
                _cloud.StatusChanged += OnCloudStatusChanged;
            }
        }
    }

    public BridgeService(DatabaseService database, ScaleReaderService scale)
    {
        _database = database;
        _scale = scale;
    }

    public void Attach(CoreWebView2 webView)
    {
        lock (_gate)
        {
            if (_webView is not null)
            {
                _webView.WebMessageReceived -= OnWebMessageReceived;
            }

            _webView = webView;
            _uiContext = SynchronizationContext.Current;
            _webView.WebMessageReceived += OnWebMessageReceived;
            _scale.ReadingReceived += OnReadingReceived;
            _scale.StatusChanged += OnScaleStatusChanged;
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var json = e.WebMessageAsJson;
        if (TryHandleThemeOrUiReady(json))
        {
            return;
        }
        _ = HandleMessageAsync(json);
    }

    private bool TryHandleThemeOrUiReady(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return false;

            if (!doc.RootElement.TryGetProperty("type", out var typeProp))
                return false;

            var type = typeProp.GetString();
            if (string.Equals(type, "theme-changed", StringComparison.OrdinalIgnoreCase))
            {
                if (doc.RootElement.TryGetProperty("theme", out var themeProp) && themeProp.GetString() is { } theme)
                {
                    ThemeChanged?.Invoke(theme);
                }
                return true;
            }

            if (string.Equals(type, "ui-ready", StringComparison.OrdinalIgnoreCase))
            {
                if (doc.RootElement.TryGetProperty("theme", out var themeProp) && themeProp.GetString() is { } theme)
                {
                    ThemeChanged?.Invoke(theme);
                }
                UiReady?.Invoke();
                return true;
            }

            return false;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private async Task HandleMessageAsync(string json)
    {
        CommandEnvelope? envelope = null;
        try
        {
            envelope = JsonSerializer.Deserialize<CommandEnvelope>(json, Json);
            if (envelope is null || string.IsNullOrWhiteSpace(envelope.Command))
                return;
            if (string.IsNullOrWhiteSpace(envelope.RequestId))
                envelope.RequestId = Guid.NewGuid().ToString("N");

            // Database work runs on the thread pool so DB latency never stalls
            // the WPF render thread (splash/UI stays responsive during boot).
            var data = await Task.Run(() => DispatchAsync(envelope!.Command, envelope.Payload));
            Respond(CommandResponse.Ok(envelope.RequestId, data));
        }
        catch (Exception ex)
        {
            Respond(CommandResponse.Fail(
                envelope?.RequestId ?? Guid.NewGuid().ToString("N"),
                ex.Message));
        }
    }

    private async Task<object?> DispatchAsync(string command, JsonElement payload)
    {
        switch (command)
        {
            case "getBootState":
                return _database.GetBootState();

            case "getOperators":
                return _database.GetOperators();

            case "authenticatePin":
            {
                var request = Deserialize<PinAuthRequest>(payload);
                return _database.AuthenticateOperator(request.OperatorId, request.Pin);
            }

            case "unlockProfileAdmin":
                return UnlockProfileAdmin(Deserialize<ProfileAdminAuthRequest>(payload));

            case "createProfile":
            {
                var request = Deserialize<ProfileWriteRequest>(payload);
                var actor = RequireProfileAdmin(request.Token);
                return _database.CreateProfile(request, actor.Id, actor.Name);
            }

            case "updateProfile":
            {
                var request = Deserialize<ProfileWriteRequest>(payload);
                var actor = RequireProfileAdmin(request.Token);
                return _database.UpdateProfile(request, actor.Id, actor.Name);
            }

            case "setProfilePin":
            {
                var request = Deserialize<SetProfilePinRequest>(payload);
                var actor = RequireProfileAdmin(request.Token);
                return _database.SetProfilePin(request, actor.Id, actor.Name);
            }

            case "deactivateProfile":
            {
                var request = Deserialize<DeactivateProfileRequest>(payload);
                var actor = RequireProfileAdmin(request.Token);
                return _database.DeactivateProfile(request, actor.Id, actor.Name);
            }

            case "getVehicles":
            {
                var request = Deserialize<VehicleQueryRequest>(payload);
                return request.IncludeArchived
                    ? _database.GetVehicles()
                    : _database.GetActiveVehicles();
            }

            case "getPendingTickets":
                return _database.GetPendingTickets();

            case "getHistory":
            {
                var request = Deserialize<HistoryQueryRequest>(payload);
                return _database.GetHistory(request.Limit, request.Status);
            }

            case "queryHistory":
            {
                var request = Deserialize<HistoryPageRequest>(payload);
                return _database.HistoryPage(request);
            }

            case "getTicket":
            {
                var request = Deserialize<TicketIdRequest>(payload);
                return _database.GetTicket(request.TicketId);
            }

            case "generateHistoryReport":
                return _database.GenerateHistoryReport(Deserialize<HistoryReportRequest>(payload));

            case "verifyHistoryReport":
                return _database.VerifyHistoryReport(Deserialize<VerifyHistoryReportRequest>(payload));

            case "showSystemPrintDialog":
                if (_webView is null)
                    throw new InvalidOperationException("The print dialog is unavailable.");
                // ShowPrintUI must run on the UI thread, but the dispatch itself
                // now happens on the pool, so hop over and await the dialog.
                return await ShowPrintDialogOnUi();

            case "getNextTicketNumber":
                return _database.PeekNextTicketNumber();

            case "getSyncStatus":
                return _database.GetSyncStatus();

            case "getCloudStatus":
                return Cloud?.GetCloudStatus() ?? new
                {
                    status = "offline",
                    licenseActive = true,
                    cloudSyncEnabled = true,
                    lastHeartbeatAt = (string?)null,
                    lastSyncAt = (string?)null,
                    lastError = (string?)null,
                    graceDaysRemaining = 30,
                };

            case "syncNow":
                return Cloud is not null
                    ? await Cloud.SyncNowAsync()
                    : _database.GetSyncStatus();

            case "retryArchive":
            {
                var archive = Archive
                    ?? throw new InvalidOperationException("The archive service is not ready.");
                return new { retried = archive.RetryFailedNow() };
            }

            case "getScaleStatus":
                return new
                {
                    isConnected = _scale.IsConnected,
                    isSimulator = _scale.IsSimulator,
                    portName = _scale.PortName,
                    message = _scale.StatusMessage,
                    hasReading = _scale.LastReading is not null,
                };

            case "captureReading":
                _capturedReading = _scale.LastReading;
                return new { captured = _capturedReading is not null };

            case "createTicket":
            {
                var request = Deserialize<CreateTicketRequest>(payload);
                AttachReading(reading => request.Reading = reading);
                var ticket = _database.CreateTicket(request);
                _capturedReading = null;
                return ticket;
            }

            case "completeTicket":
            {
                var request = Deserialize<CompleteTicketRequest>(payload);
                AttachReading(reading => request.Reading = reading);
                var ticket = _database.CompleteTicket(request);
                _capturedReading = null;
                return ticket;
            }

            case "voidTicket":
                return _database.VoidTicket(Deserialize<TicketReasonRequest>(payload));

            case "deleteTicket":
                return _database.SoftDeleteTicket(Deserialize<TicketReasonRequest>(payload));

            case "registerVehicle":
                return _database.RegisterVehicle(Deserialize<VehicleRequest>(payload));

            case "archiveVehicle":
            {
                var request = Deserialize<ArchiveVehicleRequest>(payload);
                var result = _database.ArchiveVehicle(request);
                if (!result.Ok) throw new InvalidOperationException(result.Error ?? "Archive failed.");
                return result.Vehicle;
            }

            case "restoreVehicle":
            {
                var request = Deserialize<ArchiveVehicleRequest>(payload);
                return _database.RestoreVehicle(request)
                       ?? throw new InvalidOperationException("Vehicle not found.");
            }

            case "deleteVehicle":
            {
                var request = Deserialize<DeleteVehicleRequest>(payload);
                var result = _database.DeleteVehicle(request);
                if (!result.Ok) throw new InvalidOperationException(result.Error ?? "Delete failed.");
                return true;
            }

            case "recordReprint":
            {
                var request = Deserialize<ReprintRequest>(payload);
                var result = _database.RecordReprint(request);
                return new { ticket = result.Ticket, copyNumber = result.CopyNumber };
            }

            default:
                throw new InvalidOperationException($"Unknown command '{command}'.");
        }
    }

    private object UnlockProfileAdmin(ProfileAdminAuthRequest request)
    {
        var actor = _database.AuthenticateSupervisor(request.OperatorId, request.Pin)
                    ?? throw new InvalidOperationException("Supervisor PIN is incorrect.");

        var token = Guid.NewGuid().ToString("N");
        var expiresAt = DateTimeOffset.Now.Add(ProfileAdminSessionLifetime);
        lock (_adminGate)
        {
            _profileAdminToken = token;
            _profileAdminActor = actor;
            _profileAdminExpiresAt = expiresAt;
        }

        return new { token, expiresAt, actor };
    }

    private ProfileDto RequireProfileAdmin(string token)
    {
        lock (_adminGate)
        {
            if (string.IsNullOrWhiteSpace(token) ||
                _profileAdminToken is null ||
                !string.Equals(token, _profileAdminToken, StringComparison.Ordinal) ||
                DateTimeOffset.Now > _profileAdminExpiresAt)
            {
                _profileAdminToken = null;
                _profileAdminActor = null;
                throw new InvalidOperationException(
                    "The supervisor session expired. Enter the supervisor PIN again.");
            }

            _profileAdminExpiresAt = DateTimeOffset.Now.Add(ProfileAdminSessionLifetime);
            return _profileAdminActor!;
        }
    }

    private Task<bool> ShowPrintDialogOnUi()
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        RunOnUi(() =>
        {
            try
            {
                _webView?.ShowPrintUI(CoreWebView2PrintDialogKind.System);
                completion.SetResult(true);
            }
            catch (Exception ex)
            {
                completion.SetException(ex);
            }
        });
        return completion.Task;
    }

    private void AttachReading(Action<WeightReading> assign)
    {
        if (_capturedReading is not null) assign(_capturedReading);
    }

    private static T Deserialize<T>(JsonElement payload) where T : new()
    {
        if (payload.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            return new T();
        return payload.Deserialize<T>(Json) ?? new T();
    }

    private void Respond(CommandResponse response)
    {
        var json = JsonSerializer.Serialize(response, Json);
        RunOnUi(() =>
        {
            try { _webView?.PostWebMessageAsJson(json); }
            catch (ObjectDisposedException) { /* window closing */ }
        });
    }

    private void OnReadingReceived(object? sender, WeightReading reading)
    {
        if (Interlocked.CompareExchange(ref _weightPushInFlight, 1, 0) != 0) return;
        var json = JsonSerializer.Serialize(new
        {
            weight = reading.WeightKg,
            isStable = reading.IsStable,
            variance = reading.StabilityVariance,
            isConnected = true,
            source = reading.Source,
            capturedAt = reading.CapturedAt.ToString("O"),
        }, Json);

        RunOnUi(() =>
        {
            var script = $"window.ScaleApp && window.ScaleApp.onWeightData({json});";
            _webView?.ExecuteScriptAsync(script).ContinueWith(_ =>
                Interlocked.Exchange(ref _weightPushInFlight, 0));
        });
    }

    private void OnScaleStatusChanged(object? sender, ScaleConnectionStatus status)
    {
        if (Interlocked.CompareExchange(ref _statusPushInFlight, 1, 0) != 0) return;
        var json = JsonSerializer.Serialize(new
        {
            isConnected = status.Connected,
            isSimulator = status.IsSimulator,
            portName = status.PortName,
            message = status.Message,
        }, Json);

        RunOnUi(() =>
        {
            var script = $"window.ScaleApp && window.ScaleApp.onScaleStatus && window.ScaleApp.onScaleStatus({json});";
            _webView?.ExecuteScriptAsync(script).ContinueWith(_ =>
                Interlocked.Exchange(ref _statusPushInFlight, 0));
        });
    }

    private void OnCloudStatusChanged(SyncStatusDto status)
    {
        var json = JsonSerializer.Serialize(status, Json);
        RunOnUi(() =>
        {
            var script = $"window.ScaleApp && window.ScaleApp.onSyncStatus && window.ScaleApp.onSyncStatus({json});";
            _webView?.ExecuteScriptAsync(script);
        });
    }

    private void RunOnUi(Action action)
    {
        var context = _uiContext;
        if (context is null || SynchronizationContext.Current == context)
        {
            action();
            return;
        }
        context.Post(_ => action(), null);
    }
}

public sealed class PinAuthRequest
{
    public string OperatorId { get; set; } = string.Empty;
    public string Pin { get; set; } = string.Empty;
}

public sealed class TicketIdRequest
{
    public long TicketId { get; set; }
}
