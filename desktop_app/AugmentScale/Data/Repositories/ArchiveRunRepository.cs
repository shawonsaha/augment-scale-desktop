using System.Globalization;
using AugmentScale.Models;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data.Repositories;

/// <summary>
/// Local log of automatic PDF archive periods. The row is the source of truth
/// for pending/succeeded/skipped/failed work; files are written separately.
/// </summary>
internal sealed class ArchiveRunRepository
{
    private const int MaxAttempts = 5;
    private const int RecentLimit = 5;

    private readonly DatabaseContext _db;

    public ArchiveRunRepository(DatabaseContext db)
    {
        _db = db;
    }

    public void Enqueue(string kind, DateOnly periodStart, DateOnly periodEnd, DateTimeOffset now)
    {
        if (kind is not ("baseline" or "daily"))
            throw new ArgumentException("Archive kind must be baseline or daily.", nameof(kind));
        if (periodStart > periodEnd)
            throw new ArgumentException("Archive period start must not be after its end.", nameof(periodStart));

        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT OR IGNORE INTO archive_runs (
                id, organization_id, kind, period_start, period_end, status,
                attempt_count, created_at, updated_at
            ) VALUES (
                $id, $org, $kind, $start, $end, 'pending', 0, $now, $now
            );
            """;
        cmd.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$kind", kind);
        cmd.Parameters.AddWithValue("$start", DateText(periodStart));
        cmd.Parameters.AddWithValue("$end", DateText(periodEnd));
        cmd.Parameters.AddWithValue("$now", Stamp(now));
        cmd.ExecuteNonQuery();
    }

    public ArchiveRunDto? GetBaseline()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetBaseline(connection);
    }

    internal ArchiveRunDto? GetBaseline(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT * FROM archive_runs
            WHERE organization_id = $org AND kind = 'baseline'
            ORDER BY created_at DESC, id DESC
            LIMIT 1;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? ReadRun(reader) : null;
    }

    public DateOnly? GetLastDailyEnd()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT MAX(period_end) FROM archive_runs
            WHERE organization_id = $org
              AND kind = 'daily'
              AND status IN ('succeeded', 'skipped');
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        return ParseDate(Convert.ToString(cmd.ExecuteScalar(), CultureInfo.InvariantCulture));
    }

    public ArchiveRunDto? ClaimNext(DateTimeOffset now)
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();

        ArchiveRunDto? run = null;
        using (var select = connection.CreateCommand())
        {
            select.Transaction = txn;
            select.CommandText = """
                SELECT * FROM archive_runs
                WHERE organization_id = $org
                  AND (
                    status = 'pending'
                    OR (
                      status = 'failed'
                      AND attempt_count < $max
                      AND (next_attempt_at IS NULL OR next_attempt_at <= $now)
                    )
                  )
                ORDER BY CASE kind WHEN 'baseline' THEN 0 ELSE 1 END,
                         period_start,
                         created_at
                LIMIT 1;
                """;
            select.Parameters.AddWithValue("$org", _db.OrganizationId);
            select.Parameters.AddWithValue("$max", MaxAttempts);
            select.Parameters.AddWithValue("$now", Stamp(now));
            using var reader = select.ExecuteReader();
            if (reader.Read()) run = ReadRun(reader);
        }

        if (run is null)
        {
            txn.Commit();
            return null;
        }

        using (var update = connection.CreateCommand())
        {
            update.Transaction = txn;
            update.CommandText = """
                UPDATE archive_runs
                SET status = 'processing',
                    attempt_count = attempt_count + 1,
                    started_at = $now,
                    error_message = NULL,
                    next_attempt_at = NULL,
                    updated_at = $now
                WHERE id = $id;
                """;
            update.Parameters.AddWithValue("$id", run.Id);
            update.Parameters.AddWithValue("$now", Stamp(now));
            update.ExecuteNonQuery();
        }

        txn.Commit();
        run.Status = "processing";
        run.AttemptCount++;
        run.StartedAt = Stamp(now);
        run.UpdatedAt = Stamp(now);
        run.ErrorMessage = null;
        return run;
    }

    public void MarkSucceeded(string id, string filePath, string reportId, string integrityHash,
        DateTimeOffset now)
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            UPDATE archive_runs
            SET status = 'succeeded',
                file_path = $path,
                report_id = $report,
                integrity_hash = $hash,
                error_message = NULL,
                next_attempt_at = NULL,
                completed_at = $now,
                updated_at = $now
            WHERE id = $id;
            """;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$path", filePath);
        cmd.Parameters.AddWithValue("$report", reportId);
        cmd.Parameters.AddWithValue("$hash", integrityHash);
        cmd.Parameters.AddWithValue("$now", Stamp(now));
        cmd.ExecuteNonQuery();
    }

    public void MarkSkipped(string id, DateTimeOffset now)
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            UPDATE archive_runs
            SET status = 'skipped',
                file_path = NULL,
                report_id = NULL,
                integrity_hash = NULL,
                error_message = NULL,
                next_attempt_at = NULL,
                completed_at = $now,
                updated_at = $now
            WHERE id = $id;
            """;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$now", Stamp(now));
        cmd.ExecuteNonQuery();
    }

    public void MarkFailed(string id, string errorMessage, DateTimeOffset nextAttemptAt,
        DateTimeOffset now)
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            UPDATE archive_runs
            SET status = 'failed',
                error_message = $error,
                next_attempt_at = $next,
                updated_at = $now
            WHERE id = $id;
            """;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$error", TrimError(errorMessage));
        cmd.Parameters.AddWithValue("$next", Stamp(nextAttemptAt));
        cmd.Parameters.AddWithValue("$now", Stamp(now));
        cmd.ExecuteNonQuery();
    }

    public int RecoverStaleProcessing(DateTimeOffset now)
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            UPDATE archive_runs
            SET status = CASE WHEN attempt_count >= $max THEN 'failed' ELSE 'pending' END,
                error_message = CASE
                    WHEN attempt_count >= $max
                    THEN COALESCE(error_message, 'Archive generation was interrupted repeatedly.')
                    ELSE error_message
                END,
                started_at = NULL,
                updated_at = $now
            WHERE organization_id = $org AND status = 'processing';
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$max", MaxAttempts);
        cmd.Parameters.AddWithValue("$now", Stamp(now));
        return cmd.ExecuteNonQuery();
    }

    public int RetryFailed(DateTimeOffset now)
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            UPDATE archive_runs
            SET status = 'pending',
                attempt_count = 0,
                next_attempt_at = NULL,
                started_at = NULL,
                updated_at = $now
            WHERE organization_id = $org AND status = 'failed';
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$now", Stamp(now));
        return cmd.ExecuteNonQuery();
    }

    public ArchiveStatusDto GetStatus()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetStatus(connection);
    }

    internal ArchiveStatusDto GetStatus(SqliteConnection connection)
    {
        int pending = 0, processing = 0, failed = 0, succeeded = 0, skipped = 0;
        using (var counts = connection.CreateCommand())
        {
            counts.CommandText = """
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0)
                FROM archive_runs
                WHERE organization_id = $org;
                """;
            counts.Parameters.AddWithValue("$org", _db.OrganizationId);
            using var reader = counts.ExecuteReader();
            if (reader.Read())
            {
                pending = Convert.ToInt32(reader.GetValue(0), CultureInfo.InvariantCulture);
                processing = Convert.ToInt32(reader.GetValue(1), CultureInfo.InvariantCulture);
                failed = Convert.ToInt32(reader.GetValue(2), CultureInfo.InvariantCulture);
                succeeded = Convert.ToInt32(reader.GetValue(3), CultureInfo.InvariantCulture);
                skipped = Convert.ToInt32(reader.GetValue(4), CultureInfo.InvariantCulture);
            }
        }

        var lastSuccess = ReadLatest(connection, "status IN ('succeeded', 'skipped')",
            "completed_at DESC, period_end DESC, created_at DESC");
        var lastFailure = ReadLatest(connection, "status = 'failed'",
            "updated_at DESC, created_at DESC");
        var recent = ReadRecent(connection);

        var state = processing > 0
            ? "processing"
            : pending > 0
                ? "pending"
                : failed > 0
                    ? "failed"
                    : succeeded + skipped > 0
                        ? "success"
                        : "idle";

        return new ArchiveStatusDto
        {
            State = state,
            PendingCount = pending,
            ProcessingCount = processing,
            FailedCount = failed,
            SucceededCount = succeeded,
            SkippedCount = skipped,
            LastSuccessAt = lastSuccess?.CompletedAt,
            LastSuccessKind = lastSuccess?.Kind,
            LastSuccessPeriodEnd = lastSuccess?.PeriodEnd,
            LastSuccessFilePath = lastSuccess?.FilePath,
            LastError = lastFailure?.ErrorMessage,
            LastErrorAt = lastFailure?.UpdatedAt,
            RecentRuns = recent,
        };
    }

    private ArchiveRunDto? ReadLatest(SqliteConnection connection, string predicate, string orderBy)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"""
            SELECT * FROM archive_runs
            WHERE organization_id = $org AND {predicate}
            ORDER BY {orderBy}
            LIMIT 1;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? ReadRun(reader) : null;
    }

    private List<ArchiveRunDto> ReadRecent(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT * FROM archive_runs
            WHERE organization_id = $org
            ORDER BY period_end DESC, created_at DESC
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$limit", RecentLimit);
        var runs = new List<ArchiveRunDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) runs.Add(ReadRun(reader));
        return runs;
    }

    private static ArchiveRunDto ReadRun(SqliteDataReader reader) => new()
    {
        Id = SqliteHelpers.Text(reader, "id") ?? string.Empty,
        Kind = SqliteHelpers.Text(reader, "kind") ?? string.Empty,
        PeriodStart = SqliteHelpers.Text(reader, "period_start") ?? string.Empty,
        PeriodEnd = SqliteHelpers.Text(reader, "period_end") ?? string.Empty,
        Status = SqliteHelpers.Text(reader, "status") ?? string.Empty,
        FilePath = SqliteHelpers.Text(reader, "file_path"),
        ReportId = SqliteHelpers.Text(reader, "report_id"),
        IntegrityHash = SqliteHelpers.Text(reader, "integrity_hash"),
        ErrorMessage = SqliteHelpers.Text(reader, "error_message"),
        AttemptCount = Convert.ToInt32(reader.GetValue(reader.GetOrdinal("attempt_count")),
            CultureInfo.InvariantCulture),
        NextAttemptAt = SqliteHelpers.Text(reader, "next_attempt_at"),
        CreatedAt = SqliteHelpers.Text(reader, "created_at") ?? string.Empty,
        StartedAt = SqliteHelpers.Text(reader, "started_at"),
        CompletedAt = SqliteHelpers.Text(reader, "completed_at"),
        UpdatedAt = SqliteHelpers.Text(reader, "updated_at") ?? string.Empty,
    };

    private static string DateText(DateOnly value) =>
        value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateOnly? ParseDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var date)
            ? date
            : null;
    }

    private static string Stamp(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static string TrimError(string value)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length <= 1000 ? text : text[..1000];
    }
}
