using System.Globalization;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using AugmentScale.Services;
using Xunit;

namespace AugmentScale.Tests;

public sealed class PdfArchiveTests
{
    [Fact]
    public void Schema_ContainsArchiveRunsTableAndIndexes()
    {
        using var temp = new TempDatabase();
        using var connection = temp.Database.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT name FROM sqlite_master
            WHERE type IN ('table', 'index')
              AND (name = 'archive_runs' OR name LIKE 'idx_archive_runs%');
            """;

        var names = new List<string>();
        using var reader = command.ExecuteReader();
        while (reader.Read()) names.Add(reader.GetString(0));

        Assert.Contains("archive_runs", names);
        Assert.Contains("idx_archive_runs_period", names);
        Assert.Contains("idx_archive_runs_baseline", names);
        Assert.Contains("idx_archive_runs_due", names);
        Assert.Contains("idx_archive_runs_recent", names);
    }

    [Fact]
    public void ArchiveReport_UsesSystemActorAndSkipsEmptyRanges()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var day = new DateTime(2026, 9, 14, 10, 0, 0);
        var ticket = db.CreateTicket(NewTicket("ARCH-REPORT", day));
        var before = ReportAuditCount(db);

        var empty = db.Reports.GenerateArchiveReport(
            DateOnly.FromDateTime(day.AddDays(-10)),
            DateOnly.FromDateTime(day.AddDays(-10)));

        Assert.Null(empty);
        Assert.Equal(before, ReportAuditCount(db));

        var report = db.Reports.GenerateArchiveReport(
            DateOnly.FromDateTime(day),
            DateOnly.FromDateTime(day));

        Assert.NotNull(report);
        Assert.Equal("system", report!.OperatorId);
        Assert.Equal("Automatic archive", report.OperatorName);
        Assert.Contains(report.Tickets, item => item.Id == ticket.Id);
        Assert.Equal(before + 1, ReportAuditCount(db));
        Assert.NotNull(db.Reports.GetEarliestReportDate());
    }

    [Fact]
    public void Repository_EnqueueClaimFailRetryAndSucceed()
    {
        using var temp = new TempDatabase();
        var repository = temp.Database.ArchiveRuns;
        var now = LocalAt(new DateTime(2026, 9, 15, 10, 0, 0));
        var day = new DateOnly(2026, 9, 14);

        repository.Enqueue("baseline", day, day, now);
        repository.Enqueue("baseline", day, day, now);

        var pending = repository.GetStatus();
        Assert.Equal(1, pending.PendingCount);
        Assert.Single(pending.RecentRuns);

        var claimed = repository.ClaimNext(now);
        Assert.NotNull(claimed);
        Assert.Equal("processing", claimed!.Status);
        Assert.Equal(1, claimed.AttemptCount);

        repository.MarkFailed(claimed.Id, "renderer failed", now.AddMinutes(1), now);
        Assert.Equal(1, repository.GetStatus().FailedCount);
        Assert.Null(repository.ClaimNext(now));

        Assert.Equal(1, repository.RetryFailed(now));
        var retried = repository.ClaimNext(now);
        Assert.NotNull(retried);
        Assert.Equal(1, retried!.AttemptCount);
        Assert.Null(retried.ErrorMessage);

        repository.MarkSucceeded(retried.Id, "baseline/test.pdf", "HR-TEST",
            new string('a', 64), now);

        var succeeded = repository.GetBaseline();
        Assert.NotNull(succeeded);
        Assert.Equal("succeeded", succeeded!.Status);
        Assert.Equal("baseline/test.pdf", succeeded.FilePath);
        Assert.Equal("HR-TEST", succeeded.ReportId);
        Assert.Equal("success", repository.GetStatus().State);
    }

    [Fact]
    public async Task Service_CreatesBaselineAndDailyPdfAndSkipsEmptyDays()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        db.CreateTicket(NewTicket("ARCH-BASELINE", new DateTime(2026, 9, 14, 10, 0, 0)));

        var renderer = new FakePdfArchiveRenderer();
        var baselineService = new PdfArchiveService(
            db, renderer, temp.Config,
            () => LocalAt(new DateTime(2026, 9, 15, 10, 0, 0)));

        await baselineService.RunOnceAsync();

        var baseline = db.ArchiveRuns.GetBaseline();
        Assert.NotNull(baseline);
        Assert.Equal("succeeded", baseline!.Status);
        Assert.True(File.Exists(Path.Combine(temp.Config.ArchiveDirectory,
            "baseline", "augment-scale-baseline-through-2026-09-14.pdf")));
        Assert.Single(renderer.Reports);
        Assert.Equal("system", renderer.Reports[0].OperatorId);

        await baselineService.RunOnceAsync();
        Assert.Single(renderer.Reports);

        db.CreateTicket(NewTicket("ARCH-DAILY", new DateTime(2026, 9, 15, 10, 0, 0)));
        var dailyService = new PdfArchiveService(
            db, renderer, temp.Config,
            () => LocalAt(new DateTime(2026, 9, 16, 0, 5, 0)));

        await dailyService.RunOnceAsync();

        Assert.True(File.Exists(Path.Combine(temp.Config.ArchiveDirectory,
            "daily", "2026", "09", "augment-scale-2026-09-15.pdf")));
        Assert.Equal(2, renderer.Reports.Count);
        var daily = db.ArchiveRuns.GetStatus().RecentRuns
            .Single(run => run.Kind == "daily" && run.PeriodEnd == "2026-09-15");
        Assert.Equal("succeeded", daily.Status);

        var emptyService = new PdfArchiveService(
            db, renderer, temp.Config,
            () => LocalAt(new DateTime(2026, 9, 17, 0, 5, 0)));

        await emptyService.RunOnceAsync();

        var skipped = db.ArchiveRuns.GetStatus().RecentRuns
            .Single(run => run.Kind == "daily" && run.PeriodEnd == "2026-09-16");
        Assert.Equal("skipped", skipped.Status);
        Assert.Equal(2, renderer.Reports.Count);
    }

    [Fact]
    public async Task Service_MarksRenderFailureAndManualRetryProcessesIt()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        db.CreateTicket(NewTicket("ARCH-FAIL", new DateTime(2026, 9, 14, 10, 0, 0)));

        var renderer = new FakePdfArchiveRenderer { FailuresRemaining = 1 };
        var service = new PdfArchiveService(
            db, renderer, temp.Config,
            () => LocalAt(new DateTime(2026, 9, 15, 10, 0, 0)));

        await service.RunOnceAsync();

        var failed = db.ArchiveRuns.GetBaseline();
        Assert.NotNull(failed);
        Assert.Equal("failed", failed!.Status);
        Assert.Contains("renderer failed", failed.ErrorMessage);
        Assert.Equal(1, db.ArchiveRuns.GetStatus().FailedCount);
        Assert.Equal(1, renderer.Attempts);

        await service.RunOnceAsync();
        Assert.Equal(1, renderer.Attempts);

        Assert.Equal(1, service.RetryFailedNow());
        await service.RunOnceAsync();

        var succeeded = db.ArchiveRuns.GetBaseline();
        Assert.NotNull(succeeded);
        Assert.Equal("succeeded", succeeded!.Status);
        Assert.Equal(2, renderer.Attempts);
    }

    private static CreateTicketRequest NewTicket(string plate, DateTime at) => new()
    {
        TruckNo = plate,
        Driver = "Archive Test",
        Phone = "+880 1700 000000",
        Material = "Scrap Iron",
        Client = "Archive Client",
        Direction = "IN",
        WeightKg = 12000,
        FirstTime = at.ToString("dd-MM-yy hh:mm:ss tt", CultureInfo.InvariantCulture),
        OperatorId = "mr",
        OperatorName = "MD. RAJU",
        RecordFirstPrint = true,
    };

    private static DateTimeOffset LocalAt(DateTime local) =>
        new(DateTime.SpecifyKind(local, DateTimeKind.Local));

    private static int ReportAuditCount(DatabaseService db)
    {
        using var connection = db.OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM audit_events
            WHERE entity_type = 'history_report' AND action = 'generate';
            """;
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private sealed class FakePdfArchiveRenderer : IPdfArchiveRenderer
    {
        public int Attempts { get; private set; }
        public int FailuresRemaining { get; set; }
        public List<HistoryReportDto> Reports { get; } = [];

        public Task RenderAsync(HistoryReportDto report, string outputPath,
            CancellationToken cancellationToken)
        {
            Attempts++;
            if (FailuresRemaining > 0)
            {
                FailuresRemaining--;
                throw new InvalidOperationException("renderer failed");
            }

            Reports.Add(report);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            File.WriteAllText(outputPath, "%PDF-1.4 fake archive");
            return Task.CompletedTask;
        }
    }
}
