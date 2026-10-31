using System.Globalization;
using AugmentScale.Data;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using AugmentScale.Services;
using Xunit;

namespace AugmentScale.Tests;

public sealed class SiteTimezoneTests
{
    [Fact]
    public void ResolveSiteTimeZone_ResolvesIanaWindowsAndFallsBack()
    {
        var dhakaIana = ConfigService.ResolveSiteTimeZone("Asia/Dhaka");
        Assert.Equal(TimeSpan.FromHours(6), dhakaIana.BaseUtcOffset);

        var dhakaWin = ConfigService.ResolveSiteTimeZone("Bangladesh Standard Time");
        Assert.Equal(TimeSpan.FromHours(6), dhakaWin.BaseUtcOffset);

        var utc = ConfigService.ResolveSiteTimeZone("UTC");
        Assert.Equal(TimeSpan.Zero, utc.BaseUtcOffset);

        var fallbackNull = ConfigService.ResolveSiteTimeZone(null);
        Assert.NotNull(fallbackNull);

        var fallbackEmpty = ConfigService.ResolveSiteTimeZone("   ");
        Assert.NotNull(fallbackEmpty);

        var fallbackInvalid = ConfigService.ResolveSiteTimeZone("Invalid/Unknown_Zone");
        Assert.Equal(TimeZoneInfo.Local.Id, fallbackInvalid.Id);
    }

    [Fact]
    public void HistoryRangeLimits_GetUtcDayRange_TranslatesSiteLocalDatesToUtc()
    {
        var dhaka = ConfigService.ResolveSiteTimeZone("Asia/Dhaka");
        var day = new DateOnly(2026, 10, 31);

        var (fromUtc, toUtc) = HistoryRangeLimits.GetUtcDayRange(day, day, dhaka);

        // 2026-10-31 00:00:00 in UTC+6 is 2026-10-30 18:00:00 UTC
        Assert.Equal("2026-10-30 18:00:00", fromUtc);
        // 2026-11-01 00:00:00 in UTC+6 is 2026-10-31 18:00:00 UTC
        Assert.Equal("2026-10-31 18:00:00", toUtc);
    }

    [Fact]
    public void SqliteHelpers_FormatAndParseTimestamp_UsesSiteTimezone()
    {
        var dhaka = ConfigService.ResolveSiteTimeZone("Asia/Dhaka");
        // 2026-10-30 18:30:00 UTC is 2026-10-31 00:30:00 in Dhaka
        var utcPoint = new DateTimeOffset(2026, 10, 30, 18, 30, 0, TimeSpan.Zero);

        var formatted = SqliteHelpers.FormatTimestamp(utcPoint, dhaka);
        Assert.Equal("31-10-26 12:30:00 AM", formatted);

        var parsed = SqliteHelpers.ParseTimestamp("31-10-26 12:30:00 AM", dhaka);
        Assert.NotNull(parsed);
        Assert.Equal(utcPoint.ToUniversalTime(), parsed!.Value.ToUniversalTime());
    }

    [Fact]
    public void EarlyMorningTicket_FiledUnderCorrectSiteCalendarDay()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;
        var dhaka = temp.Config.SiteTimeZone;

        // Create a ticket at 02:00 AM on 2026-10-31 Dhaka local time
        // In UTC, this is 2026-10-30 20:00:00
        var ticket = db.CreateTicket(new CreateTicketRequest
        {
            TruckNo = "DHK-11-2233",
            Driver = "Late Shift Driver",
            Phone = "+880 1700 112233",
            Material = "Steel Billet",
            Client = "Dhaka Re-Rolling",
            Direction = "IN",
            WeightKg = 25000,
            FirstTime = "31-10-26 02:00:00 AM",
            OperatorId = "mr",
            OperatorName = "MD. RAJU",
            RecordFirstPrint = true,
        });
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = ticket.Id,
            WeightKg = 10000,
            SecondTime = "31-10-26 02:30:00 AM",
            OperatorId = "mr",
        });

        Assert.NotNull(ticket);

        // 1. Query history for 2026-10-31 (the site local date)
        var pageOct31 = db.Tickets.HistoryPage(new HistoryPageRequest
        {
            FromDate = "2026-10-31",
            ToDate = "2026-10-31",
            Page = 0,
            PageSize = 20,
        });
        Assert.Single(pageOct31.Tickets);
        Assert.Equal("DHK-11-2233", pageOct31.Tickets[0].TruckNo);

        // 2. Query history for 2026-10-30 (the previous calendar day)
        var pageOct30 = db.Tickets.HistoryPage(new HistoryPageRequest
        {
            FromDate = "2026-10-30",
            ToDate = "2026-10-30",
            Page = 0,
            PageSize = 20,
        });
        Assert.Empty(pageOct30.Tickets);

        // 3. Earliest report date must be 2026-10-31 in site local time
        var earliestDate = db.Reports.GetEarliestReportDate();
        Assert.Equal(new DateOnly(2026, 10, 31), earliestDate);

        // 4. Archive report for 2026-10-31 must include the ticket
        var archiveReport = db.Reports.GenerateArchiveReport(
            new DateOnly(2026, 10, 31),
            new DateOnly(2026, 10, 31));
        Assert.NotNull(archiveReport);
        Assert.Single(archiveReport!.Tickets);
        Assert.Equal("DHK-11-2233", archiveReport.Tickets[0].TruckNo);
    }

    [Fact]
    public async Task PdfArchiveService_CutoffEvaluatesInSiteTimezone()
    {
        using var temp = new TempDatabase();
        var db = temp.Database;

        // Seed a ticket on 2026-10-30 at 10:00 AM Dhaka time
        var tzTicket = db.CreateTicket(new CreateTicketRequest
        {
            TruckNo = "ARCH-TZ-1",
            Driver = "Day Driver",
            Phone = "+880 1700 000000",
            Material = "Scrap",
            Client = "Yard",
            Direction = "IN",
            WeightKg = 15000,
            FirstTime = "30-10-26 10:00:00 AM",
            OperatorId = "mr",
            OperatorName = "MD. RAJU",
            RecordFirstPrint = true,
        });
        db.CompleteTicket(new CompleteTicketRequest
        {
            TicketId = tzTicket.Id,
            WeightKg = 5000,
            SecondTime = "30-10-26 10:30:00 AM",
            OperatorId = "mr",
        });

        var renderer = new TestArchiveRenderer();

        // Dhaka 00:06 on 2026-10-31 is 18:06 on 2026-10-30 in UTC.
        // Even when clock is UTC (+00:00), EnsureSchedule should convert to Dhaka (+06:00),
        // see that it's 00:06 (past the 00:05 cutoff), and archive 2026-10-30.
        var clockAt0006Dhaka = new DateTimeOffset(2026, 10, 30, 18, 6, 0, TimeSpan.Zero);
        var service = new PdfArchiveService(db, renderer, temp.Config, () => clockAt0006Dhaka);

        await service.RunOnceAsync();

        var status = db.ArchiveRuns.GetStatus();
        Assert.Contains(status.RecentRuns, run => run.PeriodEnd == "2026-10-30" && run.Status == "succeeded");
    }

    [Fact]
    public void BootState_PopulatesSiteTimezone()
    {
        using var temp = new TempDatabase();
        var boot = temp.Database.GetBootState();
        Assert.Equal("Asia/Dhaka", boot.SiteTimezone);
    }

    private sealed class TestArchiveRenderer : IPdfArchiveRenderer
    {
        public Task RenderAsync(HistoryReportDto report, string outputPath, CancellationToken cancellationToken)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            File.WriteAllText(outputPath, "%PDF-1.4 test");
            return Task.CompletedTask;
        }
    }
}
