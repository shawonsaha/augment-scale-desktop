using System.Globalization;
using System.IO;
using AugmentScale.Data;
using AugmentScale.Models;

namespace AugmentScale.Services;

/// <summary>
/// Generates one PDF per completed business day, plus a one-time baseline,
/// while the workstation is running. Pending work is persisted in
/// archive_runs so missed days are caught up on the next launch.
/// </summary>
public sealed class PdfArchiveService : IDisposable
{
    private static readonly TimeSpan DailyCutoff = new(0, 5, 0);

    private readonly DatabaseService _database;
    private readonly IPdfArchiveRenderer _renderer;
    private readonly ConfigService _config;
    private readonly Func<DateTimeOffset> _clock;
    private readonly CancellationTokenSource _cancellation = new();
    private readonly SemaphoreSlim _wake = new(0);
    private readonly SemaphoreSlim _runGate = new(1, 1);

    private Task? _loop;
    private bool _started;
    private bool _startupScheduleDone;
    private bool _disposed;

    public PdfArchiveService(DatabaseService database, IPdfArchiveRenderer renderer,
        ConfigService config, Func<DateTimeOffset>? clock = null)
    {
        _database = database;
        _renderer = renderer;
        _config = config;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    public void Start()
    {
        if (_started) return;
        _started = true;

        _database.EnsureInitialized();
        var recovered = _database.ArchiveRuns.RecoverStaleProcessing(_clock());
        if (recovered > 0)
            AppLog.Info($"Archive scheduler recovered {recovered} interrupted run(s)");
        CleanStaging();
        _loop = Task.Run(() => RunLoopAsync(_cancellation.Token));
        Wake();
    }

    public int RetryFailedNow()
    {
        var count = _database.ArchiveRuns.RetryFailed(_clock());
        if (count > 0)
        {
            AppLog.Info($"Archive retry requested for {count} failed run(s)");
            Wake();
        }
        return count;
    }

    /// <summary>
    /// Runs one scheduler pass. Public for tests; normal operation uses Start().
    /// </summary>
    public async Task RunOnceAsync(CancellationToken cancellationToken = default)
    {
        if (!await _runGate.WaitAsync(0, cancellationToken)) return;
        try
        {
            // Throttled internally to once an hour; the archive loop is the only
            // scheduler that keeps running on a workstation left on for weeks.
            using (var connection = _database.OpenConnection())
                DatabaseMaintenance.Run(connection, _clock());

            EnsureSchedule();
            while (!cancellationToken.IsCancellationRequested)
            {
                var run = _database.ArchiveRuns.ClaimNext(_clock());
                if (run is null) break;
                await ProcessRunAsync(run, cancellationToken);
            }
        }
        finally
        {
            _runGate.Release();
        }
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                AppLog.Error("Archive scheduler iteration failed", ex);
            }

            try
            {
                await _wake.WaitAsync(TimeSpan.FromMinutes(1), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private void EnsureSchedule()
    {
        var now = _clock();
        var siteNow = TimeZoneInfo.ConvertTime(now, _config.SiteTimeZone);
        var today = DateOnly.FromDateTime(siteNow.DateTime);
        var yesterday = today.AddDays(-1);
        var includeYesterday = !_startupScheduleDone || siteNow.TimeOfDay >= DailyCutoff;
        var through = includeYesterday ? yesterday : today.AddDays(-2);

        var baseline = _database.ArchiveRuns.GetBaseline();
        if (baseline is null)
        {
            var earliest = _database.Reports.GetEarliestReportDate();
            var start = earliest is { } first && first <= through ? first : through;
            _database.ArchiveRuns.Enqueue("baseline", start, through, now);
            baseline = _database.ArchiveRuns.GetBaseline();
        }

        if (baseline is null)
        {
            _startupScheduleDone = true;
            return;
        }

        var baselineEnd = ParseDate(baseline.PeriodEnd);
        if (baselineEnd is null)
        {
            _startupScheduleDone = true;
            return;
        }

        var lastDailyEnd = _database.ArchiveRuns.GetLastDailyEnd();
        var covered = lastDailyEnd is { } dailyEnd && dailyEnd > baselineEnd.Value
            ? dailyEnd
            : baselineEnd.Value;

        var day = covered.AddDays(1);
        while (day <= through)
        {
            _database.ArchiveRuns.Enqueue("daily", day, day, now);
            day = day.AddDays(1);
        }

        _startupScheduleDone = true;
    }

    private async Task ProcessRunAsync(ArchiveRunDto run, CancellationToken cancellationToken)
    {
        string? stagingPath = null;
        try
        {
            var from = ParseDate(run.PeriodStart)
                ?? throw new InvalidOperationException("The archive period start is invalid.");
            var to = ParseDate(run.PeriodEnd)
                ?? throw new InvalidOperationException("The archive period end is invalid.");

            var report = _database.Reports.GenerateArchiveReport(from, to);
            if (report is null)
            {
                _database.ArchiveRuns.MarkSkipped(run.Id, _clock());
                AppLog.Info($"Archive skipped {run.Kind} {run.PeriodStart}..{run.PeriodEnd} (no tickets)");
                return;
            }

            var relativePath = BuildRelativePath(run.Kind, to);
            var finalPath = Path.Combine(_config.ArchiveDirectory,
                relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);

            stagingPath = Path.Combine(_config.ArchiveDirectory, ".staging", $"{run.Id}.pdf");
            Directory.CreateDirectory(Path.GetDirectoryName(stagingPath)!);

            await _renderer.RenderAsync(report, stagingPath, cancellationToken);

            if (!File.Exists(stagingPath) || new FileInfo(stagingPath).Length == 0)
                throw new InvalidOperationException("The PDF renderer did not produce a file.");

            File.Move(stagingPath, finalPath, overwrite: true);
            _database.ArchiveRuns.MarkSucceeded(run.Id, relativePath, report.ReportId,
                report.IntegrityHash, _clock());
            AppLog.Info($"Archive saved {run.Kind} {run.PeriodStart}..{run.PeriodEnd} -> {relativePath}");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            TryDelete(stagingPath);
            throw;
        }
        catch (Exception ex)
        {
            TryDelete(stagingPath);
            var delay = Backoff(run.AttemptCount);
            _database.ArchiveRuns.MarkFailed(run.Id, ex.Message, _clock().Add(delay), _clock());
            AppLog.Error(
                $"Archive failed {run.Kind} {run.PeriodStart}..{run.PeriodEnd} " +
                $"(attempt {run.AttemptCount}, retry in {delay.TotalMinutes:0} min)", ex);
        }
    }

    private void CleanStaging()
    {
        var staging = Path.Combine(_config.ArchiveDirectory, ".staging");
        Directory.CreateDirectory(staging);
        foreach (var file in Directory.EnumerateFiles(staging))
        {
            try
            {
                File.Delete(file);
            }
            catch (Exception ex)
            {
                AppLog.Error($"Could not remove stale archive file {Path.GetFileName(file)}", ex);
            }
        }
    }

    private static string BuildRelativePath(string kind, DateOnly periodEnd)
    {
        var date = periodEnd.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return kind == "baseline"
            ? $"baseline/augment-scale-baseline-through-{date}.pdf"
            : $"daily/{periodEnd.ToString("yyyy", CultureInfo.InvariantCulture)}/" +
              $"{periodEnd.ToString("MM", CultureInfo.InvariantCulture)}/" +
              $"augment-scale-{date}.pdf";
    }

    private static DateOnly? ParseDate(string value) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var date)
            ? date
            : null;

    private static TimeSpan Backoff(int attempts) => attempts switch
    {
        <= 1 => TimeSpan.FromMinutes(1),
        2 => TimeSpan.FromMinutes(5),
        3 => TimeSpan.FromMinutes(15),
        4 => TimeSpan.FromHours(1),
        _ => TimeSpan.FromHours(6),
    };

    private static void TryDelete(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // The next scheduler pass will overwrite the staging file.
        }
    }

    private void Wake()
    {
        try
        {
            _wake.Release();
        }
        catch (ObjectDisposedException)
        {
            // Shutdown won the race.
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cancellation.Cancel();
        Wake();
        if (_renderer is IDisposable disposable) disposable.Dispose();
    }
}
