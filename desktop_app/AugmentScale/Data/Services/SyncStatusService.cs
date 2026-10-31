using System.Globalization;
using AugmentScale.Data.Repositories;
using AugmentScale.Models;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data.Services;

internal sealed class SyncStatusService : ISyncStatusService
{
    private readonly DatabaseContext _db;
    private readonly ArchiveRunRepository _archives;

    public SyncStatusService(DatabaseContext db, ArchiveRunRepository archives)
    {
        _db = db;
        _archives = archives;
    }

    public SyncStatusDto GetSyncStatus()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetSyncStatus(connection);
    }

    internal SyncStatusDto GetSyncStatus(SqliteConnection connection)
    {
        int pending = 0;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE status = 'pending';";
            pending = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        int deadLetters = 0;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE status = 'dead_letter';";
            try
            {
                deadLetters = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
            }
            catch (SqliteException)
            {
                // Fallback for pre-V006 schema
            }
        }

        int failingTickets = 0;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE entity_type = 'weigh_tickets' AND status = 'pending' AND attempts >= 10;";
            try
            {
                failingTickets = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
            }
            catch (SqliteException)
            {
            }
        }

        bool isHealthy = deadLetters == 0 && failingTickets == 0;

        string lastSync = DateTimeOffset.Now.ToString("O");
        string? lastCloudSync = null;
        string cloudStatus = "offline";
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT last_synced_at, last_cloud_sync_at, cloud_status FROM sync_cursors WHERE id = 'local';";
            try
            {
                using var reader = cmd.ExecuteReader();
                if (reader.Read())
                {
                    lastSync = reader.IsDBNull(0) ? lastSync : reader.GetString(0);
                    lastCloudSync = reader.IsDBNull(1) ? null : reader.GetString(1);
                    cloudStatus = reader.IsDBNull(2) ? "offline" : reader.GetString(2);
                }
            }
            catch (SqliteException)
            {
                // Fallback for pre-V003 schema if encountered
            }
        }

        bool licenseActive = true;
        bool cloudSyncEnabled = true;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT license_active, enable_cloud_sync, last_cloud_success_at FROM license_cache WHERE id = 'current';";
            try
            {
                using var reader = cmd.ExecuteReader();
                if (reader.Read())
                {
                    licenseActive = reader.GetInt32(0) == 1;
                    cloudSyncEnabled = reader.GetInt32(1) == 1;
                    if (!reader.IsDBNull(2) && DateTimeOffset.TryParse(reader.GetString(2), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dt))
                    {
                        if ((DateTimeOffset.UtcNow - dt).TotalDays > 30)
                        {
                            licenseActive = false;
                        }
                    }
                }
            }
            catch (SqliteException)
            {
                // Fallback if license_cache not created yet
            }
        }

        return new SyncStatusDto
        {
            IsHealthy = isHealthy,
            PendingQueue = pending,
            DeadLetterQueue = deadLetters,
            OutboxTotal = pending + deadLetters,
            LastSyncTimestamp = lastSync,
            Archive = _archives.GetStatus(connection),
            CloudStatus = cloudStatus,
            CloudSyncEnabled = cloudSyncEnabled,
            LicenseActive = licenseActive,
            LastCloudSyncTimestamp = lastCloudSync,
        };
    }
}
