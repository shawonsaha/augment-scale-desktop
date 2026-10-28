using Microsoft.Data.Sqlite;

namespace AugmentScale.Data.Services;

internal sealed class ScaleHealthService : IScaleHealthService
{
    private readonly DatabaseContext _db;
    private readonly object _healthGate = new();
    private SqliteConnection? _healthConnection;

    public ScaleHealthService(DatabaseContext db)
    {
        _db = db;
    }

    public void RecordScaleHealth(string eventType, string details, DateTimeOffset? at = null)
    {
        _db.EnsureInitialized();
        lock (_healthGate)
        {
            _healthConnection ??= _db.OpenConnection();

            using var cmd = _healthConnection.CreateCommand();
            cmd.CommandText = """
                INSERT INTO scale_health_events (
                    id, organization_id, workstation_id, weighbridge_id,
                    event_type, details, occurred_at
                ) VALUES ($id, $org, $ws, $wb, $type, $details, $at);
                """;
            cmd.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
            cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
            cmd.Parameters.AddWithValue("$ws", _db.WorkstationId);
            cmd.Parameters.AddWithValue("$wb", _db.WeighbridgeId);
            cmd.Parameters.AddWithValue("$type", eventType);
            cmd.Parameters.AddWithValue("$details", details);
            cmd.Parameters.AddWithValue("$at", (at ?? DateTimeOffset.Now).ToString("O"));
            cmd.ExecuteNonQuery();
        }
    }
}
