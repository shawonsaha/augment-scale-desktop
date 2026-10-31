using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AugmentScale.Data.Repositories;
using AugmentScale.Models;
using AugmentScale.Models.Commands;

namespace AugmentScale.Data.Services;

internal sealed class HistoryReportService : IReportService
{
    private readonly DatabaseContext _db;
    private readonly OperatorRepository _operators;
    private readonly TicketRepository _tickets;

    public HistoryReportService(DatabaseContext db, OperatorRepository operators, TicketRepository tickets)
    {
        _db = db;
        _operators = operators;
        _tickets = tickets;
    }

    public HistoryReportDto GenerateHistoryReport(HistoryReportRequest req)
    {
        _db.EnsureInitialized();
        if (!DateOnly.TryParseExact(req.FromDate, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var fromDate))
            throw new InvalidOperationException("Choose a valid report start date.");
        if (!DateOnly.TryParseExact(req.ToDate, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var toDate))
            throw new InvalidOperationException("Choose a valid report end date.");
        if (fromDate > toDate)
            throw new InvalidOperationException("The report start date must be before the end date.");
        HistoryRangeLimits.EnsureValidRange(fromDate, toDate, "report");
        if (!_db.Config.AuthenticatePin(req.OperatorId, req.Pin))
            throw new InvalidOperationException("Incorrect PIN. The report was not generated.");

        var operatorProfile = _operators.GetOperators()
            .FirstOrDefault(op => op.Id.Equals(req.OperatorId, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("The signed-in operator was not found.");

        var siteNow = TimeZoneInfo.ConvertTime(DateTimeOffset.Now, _db.Config.SiteTimeZone);
        var today = DateOnly.FromDateTime(siteNow.DateTime);
        var includePending = toDate >= today;

        return GenerateReport(fromDate, toDate, operatorProfile.Id, operatorProfile.Name,
            auditEmpty: true, includePending: includePending) ?? throw new InvalidOperationException("The report could not be generated.");
    }

    public HistoryReportDto? GenerateArchiveReport(DateOnly fromDate, DateOnly toDate)
    {
        if (fromDate > toDate)
            throw new InvalidOperationException("The archive start date must be before the end date.");

        return GenerateReport(fromDate, toDate, "system", "Automatic archive", auditEmpty: false, includePending: false);
    }

    public DateOnly? GetEarliestReportDate()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT MIN(datetime(business_at))
            FROM ticket_history
            WHERE organization_id = $org AND status <> 'pending';
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);

        var value = Convert.ToString(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
        if (!DateTime.TryParseExact(value, "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var utc))
            return null;

        var siteTime = TimeZoneInfo.ConvertTimeFromUtc(utc, _db.Config.SiteTimeZone);
        return DateOnly.FromDateTime(siteTime);
    }

    private HistoryReportDto? GenerateReport(DateOnly fromDate, DateOnly toDate,
        string operatorId, string operatorName, bool auditEmpty, bool includePending = false)
    {
        _db.EnsureInitialized();
        var (fromUtc, toUtc) = HistoryRangeLimits.GetUtcDayRange(fromDate, toDate, _db.Config.SiteTimeZone);

        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();

        var tickets = _tickets.ReadTicketsForReport(connection, txn, fromUtc, toUtc, includePending);
        if (!auditEmpty && tickets.Count == 0)
        {
            txn.Rollback();
            return null;
        }

        var rangeLabel = fromDate == toDate
            ? fromDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)
            : $"{fromDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)} – {toDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)}";
        var now = DateTimeOffset.Now;
        var report = new HistoryReportDto
        {
            ReportId = $"HR-{now:yyyyMMdd-HHmmss}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}",
            GeneratedAt = now.ToString("O"),
            OrganizationName = _db.Config.Setup.Organization.Name,
            SiteName = _db.Config.Setup.Site.Name,
            WeighbridgeName = _db.Config.Setup.Weighbridge.Name,
            WorkstationName = Environment.MachineName,
            RangeLabel = rangeLabel,
            FromDate = fromDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ToDate = toDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            OperatorId = operatorId,
            OperatorName = operatorName,
            Tickets = tickets.ToList(),
        };

        foreach (var ticket in report.Tickets)
        {
            report.Summary.Total++;
            switch (ticket.Status)
            {
                case "completed":
                    report.Summary.Completed++;
                    report.Summary.NetKg += ticket.NetWeight ?? 0;
                    break;
                case "voided":
                    report.Summary.Voided++;
                    break;
                case "deleted":
                    report.Summary.Deleted++;
                    break;
                default:
                    report.Summary.Pending++;
                    break;
            }

            if (ticket.Override is not null) report.Summary.Overrides++;
            report.Summary.Reprints += ticket.PrintLog.Count(entry =>
                entry.Type == "reprint" || (entry.CopyNumber ?? 0) > 1);
        }

        var (integrityHash, canonicalJson) = ComputeReportDigest(report);
        report.IntegrityHash = integrityHash;

        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "history_report", report.ReportId, "generate",
            operatorId, operatorName,
            new
            {
                report.ReportId,
                report.IntegrityHash,
                report.FromDate,
                report.ToDate,
                report.Summary.Total,
                report.Summary.Completed,
                report.Summary.Pending,
                report.Summary.Voided,
                report.Summary.Deleted,
                report.Summary.Overrides,
                report.Summary.Reprints,
                report.Summary.NetKg,
                CanonicalJson = canonicalJson,
            },
            reason: rangeLabel);

        txn.Commit();
        return report;
    }

    public HistoryReportVerificationDto VerifyHistoryReport(VerifyHistoryReportRequest req)
    {
        _db.EnsureInitialized();
        var reportId = (req.ReportId ?? string.Empty).Trim();
        var suppliedHash = (req.IntegrityHash ?? string.Empty).Trim();

        if (reportId.Length == 0)
            throw new InvalidOperationException("Enter the report ID printed on the report.");
        if (suppliedHash.Length != 64 || !suppliedHash.All(Uri.IsHexDigit))
            throw new InvalidOperationException("Enter the full 64-character SHA-256 hash.");

        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT after_values, created_at, actor_display_name
            FROM audit_events
            WHERE organization_id = $org
              AND entity_type = 'history_report'
              AND action = 'generate'
              AND entity_id = $id
            ORDER BY created_at DESC, id DESC
            LIMIT 1;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$id", reportId);

        using var reader = cmd.ExecuteReader();
        if (!reader.Read())
        {
            return new HistoryReportVerificationDto
            {
                ReportId = reportId,
                Message = "No archived snapshot was found for this report ID.",
            };
        }

        var afterValues = reader.IsDBNull(0) ? null : reader.GetString(0);
        var generatedAt = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
        var operatorName = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);

        if (string.IsNullOrWhiteSpace(afterValues))
        {
            return new HistoryReportVerificationDto
            {
                ReportId = reportId,
                GeneratedAt = generatedAt,
                OperatorName = operatorName,
                Message = "This report has no verification snapshot.",
            };
        }

        try
        {
            using var document = JsonDocument.Parse(afterValues);
            var root = document.RootElement;
            var canonicalJson = root.TryGetProperty("canonicalJson", out var canonicalElement)
                ? canonicalElement.GetString()
                : null;
            var storedHash = root.TryGetProperty("integrityHash", out var storedElement)
                ? storedElement.GetString() ?? string.Empty
                : string.Empty;

            if (string.IsNullOrEmpty(canonicalJson))
            {
                return new HistoryReportVerificationDto
                {
                    ReportId = reportId,
                    GeneratedAt = generatedAt,
                    OperatorName = operatorName,
                    StoredHash = storedHash,
                    Message = "This report has no verification snapshot.",
                };
            }

            var computedHash = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(canonicalJson))).ToLowerInvariant();
            var storedMatches = string.Equals(computedHash, storedHash, StringComparison.OrdinalIgnoreCase);
            var suppliedMatches = string.Equals(computedHash, suppliedHash, StringComparison.OrdinalIgnoreCase);

            var message = storedMatches && suppliedMatches
                ? "Report matches the archived snapshot."
                : !storedMatches
                    ? "The archived snapshot does not match its recorded hash."
                    : "The hash does not match the archived snapshot.";

            return new HistoryReportVerificationDto
            {
                ReportId = reportId,
                Matched = storedMatches && suppliedMatches,
                ComputedHash = computedHash,
                StoredHash = storedHash,
                GeneratedAt = generatedAt,
                OperatorName = operatorName,
                Message = message,
            };
        }
        catch (JsonException)
        {
            return new HistoryReportVerificationDto
            {
                ReportId = reportId,
                GeneratedAt = generatedAt,
                OperatorName = operatorName,
                Message = "The archived snapshot is unreadable.",
            };
        }
    }

    private static (string Hash, string CanonicalJson) ComputeReportDigest(HistoryReportDto report)
    {
        var canonical = new
        {
            report.ReportId,
            report.GeneratedAt,
            report.OrganizationName,
            report.SiteName,
            report.WeighbridgeName,
            report.WorkstationName,
            report.RangeLabel,
            report.FromDate,
            report.ToDate,
            report.OperatorId,
            report.OperatorName,
            report.Tickets,
            report.Summary,
        };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(canonical, JsonDefaults.CamelCase);
        return (
            Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            Encoding.UTF8.GetString(bytes));
    }
}
