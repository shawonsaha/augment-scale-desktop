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
        int pending;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM outbox_events WHERE status = 'pending';";
            pending = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

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
            cmd.CommandText = "SELECT license_active, enable_cloud_sync FROM license_cache WHERE id = 'current';";
            try
            {
                using var reader = cmd.ExecuteReader();
                if (reader.Read())
                {
                    licenseActive = reader.GetInt32(0) == 1;
                    cloudSyncEnabled = reader.GetInt32(1) == 1;
                }
            }
            catch (SqliteException)
            {
                // Fallback if license_cache not created yet
            }
        }

        return new SyncStatusDto
        {
            IsHealthy = true,
            PendingQueue = pending,
            OutboxTotal = pending,
            LastSyncTimestamp = lastSync,
            Archive = _archives.GetStatus(connection),
            CloudStatus = cloudStatus,
            CloudSyncEnabled = cloudSyncEnabled,
            LicenseActive = licenseActive,
            LastCloudSyncTimestamp = lastCloudSync,
        };
    }
}
