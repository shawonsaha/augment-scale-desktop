using System.Globalization;
using AugmentScale.Services;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data;

/// <summary>
/// Retention for the append-only tables. Only acknowledged or failed outbox
/// rows are removed, so unsent work can never be lost here.
/// </summary>
internal static class DatabaseMaintenance
{
    private static readonly TimeSpan RunInterval = TimeSpan.FromHours(1);
    private static readonly TimeSpan HealthEventRetention = TimeSpan.FromDays(30);
    private static readonly TimeSpan OutboxRetention = TimeSpan.FromDays(30);
    private static readonly TimeSpan OutboxFailureRetention = TimeSpan.FromDays(90);

    /// <summary>
    /// Explicit static allowlist of tables permitted for maintenance pruning
    /// to prevent SQL injection via dynamic table name interpolation.
    /// </summary>
    internal static readonly HashSet<string> AllowedPruneTables = new(StringComparer.OrdinalIgnoreCase)
    {
        "scale_health_events",
        "outbox_events"
    };

    // CloudControlService re-enqueues these whenever no outbox row exists for
    // them ("has this been queued?" is answered by row absence), so pruning
    // them would push them back to the cloud every retention cycle.
    private const string BackfillTrackedTypes = "'vehicles', 'ticket_corrections'";

    private static readonly object Gate = new();
    private static DateTimeOffset _lastRun = DateTimeOffset.MinValue;

    public static void Run(SqliteConnection connection, DateTimeOffset now, bool force = false)
    {
        lock (Gate)
        {
            if (!force && now - _lastRun < RunInterval) return;
            _lastRun = now;
        }

        // julianday() parses both timestamp shapes in use ("O" round-trip with
        // offset and datetime('now') UTC), and yields NULL for garbage, which
        // leaves the row alone instead of deleting it.
        Prune(connection, "scale_health_events",
            "occurred_at IS NOT NULL AND julianday(occurred_at) < julianday($cutoff)",
            now - HealthEventRetention);

        Prune(connection, "outbox_events",
            $"""
            status = 'accepted'
              AND entity_type NOT IN ({BackfillTrackedTypes})
              AND julianday(created_at) < julianday($cutoff)
            """,
            now - OutboxRetention);

        Prune(connection, "outbox_events",
            $"""
            status IN ('rejected', 'conflict')
              AND entity_type NOT IN ({BackfillTrackedTypes})
              AND julianday(created_at) < julianday($cutoff)
            """,
            now - OutboxFailureRetention);
    }

    internal static void Prune(SqliteConnection connection, string table, string predicate,
        DateTimeOffset cutoff)
    {
        if (!AllowedPruneTables.Contains(table))
        {
            throw new ArgumentException($"Table '{table}' is not permitted for maintenance pruning.", nameof(table));
        }

        try
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"DELETE FROM {table} WHERE {predicate};";
            cmd.Parameters.AddWithValue("$cutoff", cutoff.ToString("O", CultureInfo.InvariantCulture));
            var removed = cmd.ExecuteNonQuery();
            if (removed > 0)
                AppLog.Info($"Maintenance: pruned {removed} row(s) from {table}.");
        }
        catch (SqliteException ex)
        {
            AppLog.Warn($"Maintenance: could not prune {table}: {ex.Message}");
        }
    }
}
