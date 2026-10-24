using System.Globalization;
using System.Text.Json;
using AugmentScale.Services;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data;

internal sealed class DatabaseContext
{
    private static readonly Lazy<bool> SqliteInitialized = new(() =>
    {
        SQLitePCL.Batteries_V2.Init();
        return true;
    });

    private readonly ConfigService _config;
    private readonly object _initGate = new();
    private bool _initialized;

    public DatabaseContext(ConfigService config, AuditService? audit = null)
    {
        _config = config;
        Audit = audit ?? new AuditService();
    }

    public ConfigService Config => _config;
    public AuditService Audit { get; }

    public string OrganizationId { get; private set; } = string.Empty;
    public string SiteId { get; private set; } = string.Empty;
    public string WeighbridgeId { get; private set; } = string.Empty;
    public string WorkstationId { get; private set; } = string.Empty;
    public string ScaleProfileId { get; private set; } = string.Empty;
    public string DatabasePath => _config.DatabasePath;

    public void EnsureInitialized()
    {
        if (_initialized) return;
        lock (_initGate)
        {
            if (_initialized) return;
            _ = SqliteInitialized.Value;
            _config.EnsureInitialized();

            var setup = _config.Setup;
            OrganizationId = SqliteHelpers.StableId("organization", setup.Organization.Name);
            SiteId = SqliteHelpers.StableId("site", setup.Site.Name);
            WeighbridgeId = SqliteHelpers.StableId("weighbridge", setup.Weighbridge.Name);
            WorkstationId = SqliteHelpers.StableId("workstation", Environment.MachineName);
            ScaleProfileId = SqliteHelpers.StableId("scale-profile", setup.Weighbridge.Name);

            using var connection = OpenConnection();
            SchemaMigrator.Apply(connection);
            Provisioner.Provision(this, connection);
            _initialized = true;
        }
    }

    public SqliteConnection OpenConnection()
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = _config.DatabasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            Password = _config.DatabaseKey,
        };
        var connection = new SqliteConnection(builder.ToString());
        connection.Open();
        using var pragma = connection.CreateCommand();
        pragma.CommandText = "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;";
        pragma.ExecuteNonQuery();
        return connection;
    }

    public void InsertOutbox(SqliteConnection connection, SqliteTransaction txn,
        string entityType, string entityId, string operation, object payload,
        string operatorId, string? reason = null)
    {
        int sequence;
        using (var seq = connection.CreateCommand())
        {
            seq.Transaction = txn;
            seq.CommandText = "SELECT COALESCE(MAX(sequence), 0) + 1 FROM outbox_events;";
            sequence = Convert.ToInt32(seq.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO outbox_events (
                id, sequence, entity_type, entity_id, operation, base_row_version,
                payload, workstation_id, operator_id, reason, status, created_at
            ) VALUES (
                $id, $seq, $type, $entity, $operation, NULL,
                $payload, $ws, $op, $reason, 'pending', $now
            );
            """,
            ("$id", Guid.NewGuid().ToString()), ("$seq", sequence), ("$type", entityType),
            ("$entity", entityId), ("$operation", operation),
            ("$payload", JsonSerializer.Serialize(payload, JsonDefaults.CamelCase)),
            ("$ws", WorkstationId), ("$op", SqliteHelpers.OperatorId(operatorId)),
            ("$reason", (object?)reason ?? DBNull.Value),
            ("$now", DateTimeOffset.Now.ToString("O")));
    }
}
