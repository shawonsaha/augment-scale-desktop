using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Velopack;
using AugmentScale.Models;

namespace AugmentScale.Services;

/// <summary>
/// Manages automatic background application updates powered by Velopack.
/// Coordinates with CloudControlService, verifies packages cryptographically,
/// and applies updates safely without interrupting active weighbridge captures.
/// </summary>
public sealed class UpdateService : IDisposable
{
    private static readonly TimeSpan InitialCheckDelay = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan DefaultCheckInterval = TimeSpan.FromHours(1);

    private readonly ConfigService _config;
    private readonly ScaleReaderService? _scale;
    private readonly object _gate = new();
    private readonly CancellationTokenSource _cts = new();

    private UpdateManager? _updateManager;
    private UpdateInfo? _pendingUpdate;
    private Task? _backgroundTask;
    private bool _disposed;

    public string Status { get; private set; } = "idle";
    public string? TargetVersion { get; private set; }
    public int DownloadProgress { get; private set; }
    public string? LastError { get; private set; }

    public bool IsInstalled => _updateManager?.IsInstalled ?? false;

    public string CurrentVersion
    {
        get
        {
            try
            {
                if (_updateManager?.IsInstalled == true && _updateManager.CurrentVersion != null)
                {
                    return _updateManager.CurrentVersion.ToString();
                }
            }
            catch
            {
                // Fallback to assembly/app default
            }
            return "1.0.0";
        }
    }

    public event Action<UpdateStatusDto>? StatusChanged;

    public UpdateService(ConfigService config, ScaleReaderService? scale = null)
    {
        _config = config;
        _scale = scale;

        InitializeUpdateManager();
    }

    private void InitializeUpdateManager()
    {
        var url = _config.UpdateUrl;
        if (string.IsNullOrWhiteSpace(url))
        {
            AppLog.Info("[UpdateService] No update URL configured. Auto-updates will stay idle.");
            return;
        }

        try
        {
            _updateManager = new UpdateManager(url);
            AppLog.Info($"[UpdateService] Initialized with endpoint '{url}'. Installed: {IsInstalled}, Version: {CurrentVersion}");
        }
        catch (Exception ex)
        {
            AppLog.Warn($"[UpdateService] Could not initialize UpdateManager: {ex.Message}");
        }
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_backgroundTask != null || _disposed) return;
            _backgroundTask = Task.Run(PeriodicCheckLoopAsync);
        }
    }

    private async Task PeriodicCheckLoopAsync()
    {
        try
        {
            // Initial delay to avoid network contention during app bootstrap
            await Task.Delay(InitialCheckDelay, _cts.Token);

            while (!_cts.Token.IsCancellationRequested)
            {
                try
                {
                    await CheckForUpdatesAsync(autoDownload: true, _cts.Token);
                }
                catch (OperationCanceledException) when (_cts.Token.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    AppLog.Warn($"[UpdateService] Periodic update check cycle failed: {ex.Message}");
                }

                await Task.Delay(DefaultCheckInterval, _cts.Token);
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown
        }
    }

    /// <summary>
    /// Explicitly trigger an update check (e.g. from CloudControlService heartbeat or UI).
    /// </summary>
    public void TriggerCheck()
    {
        Task.Run(async () =>
        {
            try
            {
                await CheckForUpdatesAsync(autoDownload: true, _cts.Token);
            }
            catch (Exception ex)
            {
                AppLog.Warn($"[UpdateService] Triggered update check failed: {ex.Message}");
            }
        });
    }

    /// <summary>
    /// Checks for available updates and optionally downloads them in the background.
    /// </summary>
    public async Task<string?> CheckForUpdatesAsync(bool autoDownload = true, CancellationToken ct = default)
    {
        if (_disposed) return null;

        if (_updateManager == null)
        {
            InitializeUpdateManager();
            if (_updateManager == null)
            {
                UpdateState("idle", null, 0, null);
                return null;
            }
        }

        if (!_updateManager.IsInstalled)
        {
            AppLog.Info("[UpdateService] Workstation is running in unpacked/development mode. Skipping Velopack update check.");
            UpdateState("idle", null, 0, null);
            return null;
        }

        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, ct);
        var token = linkedCts.Token;

        try
        {
            UpdateState("checking", TargetVersion, 0, null);

            var update = await _updateManager.CheckForUpdatesAsync().WaitAsync(TimeSpan.FromSeconds(30), token);
            if (update == null)
            {
                AppLog.Info("[UpdateService] Application is up to date.");
                UpdateState("idle", null, 0, null);
                return null;
            }

            var newVersion = update.TargetFullRelease.Version.ToString();
            AppLog.Info($"[UpdateService] New version available: {newVersion}");

            if (!autoDownload)
            {
                _pendingUpdate = update;
                UpdateState("update_available", newVersion, 0, null);
                return newVersion;
            }

            // Download quietly in background
            UpdateState("downloading", newVersion, 0, null);

            await _updateManager.DownloadUpdatesAsync(update, progress =>
            {
                UpdateState("downloading", newVersion, progress, null);
            }, token);

            _pendingUpdate = update;

            // Stage updates to apply automatically when the user exits the app
            _updateManager.WaitExitThenApplyUpdates(update);

            UpdateState("ready_to_restart", newVersion, 100, null);
            AppLog.Info($"[UpdateService] Update {newVersion} successfully downloaded and staged for apply.");
            return newVersion;
        }
        catch (OperationCanceledException)
        {
            UpdateState("idle", TargetVersion, DownloadProgress, null);
            return null;
        }
        catch (HttpRequestException ex)
        {
            // If the remote releases endpoint or bucket is not yet provisioned, log a clean warning
            // instead of a full stack trace, and keep the updater in idle state so UI isn't alarmed.
            AppLog.Warn($"[UpdateService] Update check skipped: Remote endpoint returned {(int?)ex.StatusCode} ({ex.Message}). Will retry next cycle.");
            UpdateState("idle", TargetVersion, 0, null);
            return null;
        }
        catch (Exception ex)
        {
            AppLog.Error("[UpdateService] Update check or download failed", ex);
            UpdateState("error", TargetVersion, 0, ex.Message);
            return null;
        }
    }

    /// <summary>
    /// Restarts the application and applies the downloaded update immediately.
    /// Refuses to restart if a truck is currently on the weighbridge scale unless force is true.
    /// </summary>
    public void ApplyUpdatesAndRestart(bool force = false)
    {
        if (_pendingUpdate == null)
        {
            throw new InvalidOperationException("No update has been downloaded yet.");
        }

        if (!force && _scale != null)
        {
            // Safety check: ensure scale is not actively reading a vehicle
            var reading = _scale.LastReading;
            if (_scale.IsConnected && reading != null && Math.Abs(reading.WeightKg) > 50)
            {
                throw new InvalidOperationException("Cannot restart workstation while active weight is on the scale platform.");
            }
        }

        AppLog.Info($"[UpdateService] Operator requested immediate restart to apply update {TargetVersion}.");
        _updateManager?.ApplyUpdatesAndRestart(_pendingUpdate);
    }

    public UpdateStatusDto GetUpdateStatus()
    {
        lock (_gate)
        {
            return new UpdateStatusDto(
                Status: Status,
                CurrentVersion: CurrentVersion,
                TargetVersion: TargetVersion,
                Progress: DownloadProgress,
                Error: LastError,
                IsInstalled: IsInstalled);
        }
    }

    private void UpdateState(string status, string? targetVersion, int progress, string? error)
    {
        UpdateStatusDto dto;
        lock (_gate)
        {
            Status = status;
            TargetVersion = targetVersion;
            DownloadProgress = progress;
            LastError = error;
            dto = GetUpdateStatus();
        }

        try
        {
            StatusChanged?.Invoke(dto);
        }
        catch (Exception ex)
        {
            AppLog.Warn($"[UpdateService] Error notifying status listeners: {ex.Message}");
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _cts.Cancel();
            _cts.Dispose();
        }
    }
}

public sealed record UpdateStatusDto(
    string Status,
    string? CurrentVersion,
    string? TargetVersion,
    int Progress,
    string? Error,
    bool IsInstalled);
