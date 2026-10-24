using System.Globalization;
using AugmentScale.Models;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data.Services;

internal sealed class SyncStatusService : ISyncStatusService
{
    private readonly DatabaseContext _db;

    public SyncStatusService(DatabaseContext db)
    {
        _db = db;
    }

    public SyncStatusDto GetSyncStatus()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetSyncStatus(connection);
    }

    internal SyncStatusDto GetSyncStatus(SqliteConnection connection)
    {
        int pending;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE status = 'pending';";
            pending = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        string lastSync = DateTimeOffset.Now.ToString("O");
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT last_synced_at FROM sync_cursors WHERE id = 'local';";
            lastSync = cmd.ExecuteScalar() as string ?? lastSync;
        }

        return new SyncStatusDto
        {
            IsHealthy = true,
            PendingQueue = pending,
            OutboxTotal = pending,
            LastSyncTimestamp = lastSync,
        };
    }
}
