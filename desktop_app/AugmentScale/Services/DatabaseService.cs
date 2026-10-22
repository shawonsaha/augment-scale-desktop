using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Services;

/// <summary>
/// SQLCipher-backed local store. Every business mutation runs in one
/// transaction together with its audit, outbox and (where applicable) print
/// records.
/// </summary>
public sealed class DatabaseService
{
    private const long FirstTicketNumber = 11353;
    private const long LastHistoricalTicketNumber = 11352;

    private static readonly string[] WebUiTimestampFormats =
    {
        "dd-MM-yy hh:mm:ss tt",
        "dd-MM-yyyy hh:mm:ss tt",
    };

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly Lazy<bool> SqliteInitialized = new(() =>
    {
        SQLitePCL.Batteries_V2.Init();
        return true;
    });

    private readonly ConfigService _config;
    private readonly AuditService _audit;
    private readonly object _initGate = new();
    private bool _initialized;

    private string _organizationId = string.Empty;
    private string _siteId = string.Empty;
    private string _weighbridgeId = string.Empty;
    private string _workstationId = string.Empty;
    private string _scaleProfileId = string.Empty;

    public DatabaseService(ConfigService config, AuditService? audit = null)
    {
        _config = config;
        _audit = audit ?? new AuditService();
    }

    public string OrganizationId { get { EnsureInitialized(); return _organizationId; } }
    public string SiteId { get { EnsureInitialized(); return _siteId; } }
    public string WeighbridgeId { get { EnsureInitialized(); return _weighbridgeId; } }
    public string WorkstationId { get { EnsureInitialized(); return _workstationId; } }
    public string ScaleProfileId { get { EnsureInitialized(); return _scaleProfileId; } }
    public string DatabasePath => _config.DatabasePath;

    public void EnsureInitialized()
    {
        if (_initialized) return;
        lock (_initGate)
        {
            if (_initialized) return;
            _ = SqliteInitialized.Value;
            _config.EnsureInitialized();
            using var connection = OpenConnection();
            ApplyMigrations(connection);
            Provision(connection);
            _initialized = true;
        }
    }

    // ---------------------------------------------------------------------
    // Connection / schema
    // ---------------------------------------------------------------------

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

    private static void ApplyMigrations(SqliteConnection connection)
    {
        using (var create = connection.CreateCommand())
        {
            create.CommandText = """
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                """;
            create.ExecuteNonQuery();
        }

        long version = 0;
        using (var read = connection.CreateCommand())
        {
            read.CommandText = "SELECT COALESCE(MAX(version), 0) FROM schema_version;";
            version = Convert.ToInt64(read.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        if (version < 1)
        {
            var sql = ReadEmbeddedSql("V001_InitialSchema.sql");
            using var apply = connection.CreateCommand();
            apply.CommandText = sql;
            apply.ExecuteNonQuery();
            using var record = connection.CreateCommand();
            record.CommandText = "INSERT INTO schema_version (version, name) VALUES (1, 'InitialSchema');";
            record.ExecuteNonQuery();
        }
    }

    private static string ReadEmbeddedSql(string suffix)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var name = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"Embedded schema '{suffix}' was not found.");
        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Embedded schema '{suffix}' could not be opened.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    private void Provision(SqliteConnection connection)
    {
        var setup = _config.Setup;
        _organizationId = StableId("organization", setup.Organization.Name);
        _siteId = StableId("site", setup.Site.Name);
        _weighbridgeId = StableId("weighbridge", setup.Weighbridge.Name);
        _workstationId = StableId("workstation", Environment.MachineName);
        _scaleProfileId = StableId("scale-profile", setup.Weighbridge.Name);

        using var txn = connection.BeginTransaction();
        var now = DateTimeOffset.Now.ToString("O");

        Exec(connection, txn, """
            INSERT INTO organizations (id, name, address, phone, email, created_at, updated_at)
            VALUES ($id, $name, $address, $phone, $email, $now, $now)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                address = excluded.address,
                phone = excluded.phone,
                email = excluded.email,
                updated_at = excluded.updated_at;
            """,
            ("$id", _organizationId), ("$name", setup.Organization.Name),
            ("$address", setup.Organization.Address), ("$phone", setup.Organization.Phone),
            ("$email", setup.Organization.Email), ("$now", now));

        Exec(connection, txn, """
            INSERT INTO sites (id, organization_id, name, address, timezone, created_at, updated_at)
            VALUES ($id, $org, $name, $address, $timezone, $now, $now)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                address = excluded.address,
                timezone = excluded.timezone,
                updated_at = excluded.updated_at;
            """,
            ("$id", _siteId), ("$org", _organizationId), ("$name", setup.Site.Name),
            ("$address", setup.Site.Address), ("$timezone", setup.Site.Timezone), ("$now", now));

        Exec(connection, txn, """
            INSERT INTO weighbridges (id, site_id, name, max_capacity_kg, min_division_kg, created_at, updated_at)
            VALUES ($id, $site, $name, $max, $min, $now, $now)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                max_capacity_kg = excluded.max_capacity_kg,
                min_division_kg = excluded.min_division_kg,
                updated_at = excluded.updated_at;
            """,
            ("$id", _weighbridgeId), ("$site", _siteId), ("$name", setup.Weighbridge.Name),
            ("$max", setup.Weighbridge.MaxCapacityKg), ("$min", setup.Weighbridge.MinDivisionKg),
            ("$now", now));

        Exec(connection, txn, """
            INSERT INTO workstations (
                id, organization_id, site_id, weighbridge_id, hostname, registered_at,
                last_seen_at, settings, created_at, updated_at
            ) VALUES ($id, $org, $site, $wb, $host, $now, $now, $settings, $now, $now)
            ON CONFLICT(id) DO UPDATE SET
                hostname = excluded.hostname,
                last_seen_at = excluded.last_seen_at,
                settings = excluded.settings,
                updated_at = excluded.updated_at;
            """,
            ("$id", _workstationId), ("$org", _organizationId), ("$site", _siteId),
            ("$wb", _weighbridgeId), ("$host", Environment.MachineName), ("$now", now),
            ("$settings", JsonSerializer.Serialize(new { appVersion = "1.0.0" }, Json)));

        var scale = setup.ScaleConnection;
        Exec(connection, txn, """
            INSERT INTO scale_connection_profiles (
                id, weighbridge_id, port_name, baud_rate, data_bits, parity, stop_bits,
                protocol_format, stability_window_ms, stability_tolerance_kg,
                effective_from, version, approved_by, change_reason, created_at
            ) VALUES (
                $id, $wb, $port, $baud, $dataBits, $parity, $stopBits,
                $format, $window, $tolerance, $from, 1, 'setup.json', 'first-run provisioning', $now
            )
            ON CONFLICT(id) DO UPDATE SET
                port_name = excluded.port_name,
                baud_rate = excluded.baud_rate,
                data_bits = excluded.data_bits,
                parity = excluded.parity,
                stop_bits = excluded.stop_bits,
                protocol_format = excluded.protocol_format,
                stability_window_ms = excluded.stability_window_ms,
                stability_tolerance_kg = excluded.stability_tolerance_kg;
            """,
            ("$id", _scaleProfileId), ("$wb", _weighbridgeId), ("$port", scale.PortName),
            ("$baud", scale.BaudRate), ("$dataBits", scale.DataBits), ("$parity", scale.Parity),
            ("$stopBits", scale.StopBits), ("$format", scale.ProtocolFormat),
            ("$window", scale.StabilityWindowMs), ("$tolerance", scale.StabilityToleranceKg),
            ("$from", now), ("$now", now));

        foreach (var op in setup.Operators)
        {
            if (string.IsNullOrWhiteSpace(op.Id)) op.Id = StableId("profile", op.DisplayName)[..12];
            Exec(connection, txn, """
                INSERT INTO profiles (
                    id, organization_id, display_name, first_name, initials, avatar_url,
                    color, shift, is_active, created_at, updated_at
                ) VALUES ($id, $org, $name, $first, $initials, $avatar, $color, $shift, 1, $now, $now)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    first_name = excluded.first_name,
                    initials = excluded.initials,
                    avatar_url = excluded.avatar_url,
                    color = excluded.color,
                    shift = excluded.shift,
                    is_active = 1,
                    updated_at = excluded.updated_at;
                """,
                ("$id", op.Id), ("$org", _organizationId), ("$name", op.DisplayName),
                ("$first", op.FirstName), ("$initials", op.Code), ("$avatar", op.Avatar),
                ("$color", op.Color), ("$shift", op.Shift), ("$now", now));

            Exec(connection, txn, """
                INSERT INTO user_roles (id, profile_id, organization_id, site_id, role, granted_at, granted_by)
                VALUES ($id, $profile, $org, $site, $role, $now, 'setup.json')
                ON CONFLICT(id) DO UPDATE SET role = excluded.role, revoked_at = NULL, revoked_by = NULL;
                """,
                ("$id", $"role-{op.Id}"), ("$profile", op.Id), ("$org", _organizationId),
                ("$site", _siteId), ("$role", op.Role.ToLowerInvariant()), ("$now", now));
        }

        SeedVehiclesIfEmpty(connection, txn, now);

        Exec(connection, txn, """
            INSERT INTO sync_cursors (id, last_sync_change_id, last_synced_at)
            SELECT 'local', 0, $now
            WHERE NOT EXISTS (SELECT 1 FROM sync_cursors);
            """, ("$now", now));

        txn.Commit();
    }

    private void SeedVehiclesIfEmpty(SqliteConnection connection, SqliteTransaction txn, string now)
    {
        using var count = connection.CreateCommand();
        count.Transaction = txn;
        count.CommandText = "SELECT COUNT(*) FROM vehicles WHERE organization_id = $org;";
        count.Parameters.AddWithValue("$org", _organizationId);
        if (Convert.ToInt64(count.ExecuteScalar(), CultureInfo.InvariantCulture) > 0) return;

        var seeds = new (string Plate, string Driver, string Phone, string Material, string Client)[]
        {
            ("DM-T-11-2045", "Kalam Hossain", "+880 1711 002233", "Scrap Iron", "BSRM Steels Ltd"),
            ("CTG-4512", "Anwar Ali", "+880 1819 445566", "MS Plate", "Abul Khair Steel"),
            ("DM-K-33-1078", "Sumon Mia", "+880 1912 778899", "Pipe", "Apex Cement Mills"),
            ("DHAKA-METRO-TA-14-9921", "Rafiqul Islam", "+880 1670 112233", "Machinery", "GPH Ispat"),
            ("CTG-TA-12-8844", "Jasmin Uddin", "+880 1552 998877", "Copper / Cable", "Crown Cement"),
        };

        foreach (var seed in seeds)
        {
            Exec(connection, txn, """
                INSERT INTO vehicles (
                    id, organization_id, plate_number, plate_normalized,
                    default_driver_name, default_driver_phone, default_client,
                    default_material, registered_by, created_at, updated_at
                ) VALUES ($id, $org, $plate, $normalized, $driver, $phone, $client, $material, 'setup.json', $now, $now);
                """,
                ("$id", Guid.NewGuid().ToString()), ("$org", _organizationId), ("$plate", seed.Plate),
                ("$normalized", NormalizePlate(seed.Plate)), ("$driver", seed.Driver),
                ("$phone", seed.Phone), ("$client", seed.Client), ("$material", seed.Material),
                ("$now", now));
        }
    }

    // ---------------------------------------------------------------------
    // Profiles / vehicles
    // ---------------------------------------------------------------------

    public IReadOnlyList<ProfileDto> GetOperators()
    {
        EnsureInitialized();
        using var connection = OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT p.id, p.display_name, p.first_name, p.initials, p.avatar_url,
                   p.color, p.shift, r.role
            FROM profiles p
            LEFT JOIN user_roles r ON r.profile_id = p.id AND r.revoked_at IS NULL
            WHERE p.organization_id = $org AND p.is_active = 1 AND p.deleted_at IS NULL
            ORDER BY p.created_at;
            """;
        cmd.Parameters.AddWithValue("$org", _organizationId);

        var results = new List<ProfileDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var id = Text(reader, "id") ?? string.Empty;
            results.Add(new ProfileDto
            {
                Id = id,
                Code = Text(reader, "initials") ?? id.ToUpperInvariant(),
                Name = Text(reader, "display_name") ?? id,
                FirstName = Text(reader, "first_name") ?? "",
                Role = TitleCase(Text(reader, "role") ?? "operator"),
                Shift = Text(reader, "shift") ?? "Shift A",
                Avatar = Text(reader, "avatar_url") ?? "avatars/frame-9.svg",
                Color = Text(reader, "color") ?? "#4C7875",
                PinSet = _config.HasPin(id),
            });
        }
        return results;
    }

    public ProfileDto? AuthenticateOperator(string profileId, string pin)
    {
        if (!_config.AuthenticatePin(profileId, pin)) return null;
        return GetOperators().FirstOrDefault(o => o.Id.Equals(profileId, StringComparison.OrdinalIgnoreCase));
    }

    public IReadOnlyList<VehicleDto> GetVehicles()
    {
        EnsureInitialized();
        using var connection = OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT * FROM vehicles
            WHERE organization_id = $org
            ORDER BY (deleted_at IS NOT NULL), last_weighed_at DESC, created_at DESC;
            """;
        cmd.Parameters.AddWithValue("$org", _organizationId);

        var results = new List<VehicleDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) results.Add(MapVehicle(reader));
        return results;
    }

    public VehicleDto RegisterVehicle(VehicleRequest req)
    {
        EnsureInitialized();
        var plate = req.Plate.Trim();
        if (plate.Length == 0) throw new InvalidOperationException("Truck number is required.");
        var normalized = NormalizePlate(plate);
        var now = DateTimeOffset.Now;

        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        string? existingId = null;
        using (var find = connection.CreateCommand())
        {
            find.Transaction = txn;
            find.CommandText = "SELECT id FROM vehicles WHERE organization_id = $org AND plate_normalized = $plate;";
            find.Parameters.AddWithValue("$org", _organizationId);
            find.Parameters.AddWithValue("$plate", normalized);
            existingId = find.ExecuteScalar() as string;
        }

        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var id = existingId ?? Guid.NewGuid().ToString();

        if (existingId is null)
        {
            Exec(connection, txn, """
                INSERT INTO vehicles (
                    id, organization_id, plate_number, plate_normalized,
                    default_driver_name, default_driver_phone, default_client,
                    default_material, registered_by, created_at, updated_at
                ) VALUES ($id, $org, $plate, $normalized, $driver, $phone, $client, $material, $by, $now, $now);
                """,
                ("$id", id), ("$org", _organizationId), ("$plate", plate),
                ("$normalized", normalized), ("$driver", req.Driver), ("$phone", req.Phone),
                ("$client", req.Client), ("$material", req.Material), ("$by", operatorName),
                ("$now", now.ToString("O")));
        }
        else
        {
            Exec(connection, txn, """
                UPDATE vehicles SET
                    plate_number = $plate,
                    default_driver_name = CASE WHEN $driver = '' THEN default_driver_name ELSE $driver END,
                    default_driver_phone = CASE WHEN $phone = '' THEN default_driver_phone ELSE $phone END,
                    default_client = CASE WHEN $client = '' THEN default_client ELSE $client END,
                    default_material = CASE WHEN $material = '' THEN default_material ELSE $material END,
                    registered_by = $by,
                    updated_by = $by,
                    row_version = row_version + 1,
                    updated_at = $now
                WHERE id = $id;
                """,
                ("$id", id), ("$plate", plate), ("$driver", req.Driver), ("$phone", req.Phone),
                ("$client", req.Client), ("$material", req.Material), ("$by", operatorName),
                ("$now", now.ToString("O")));
        }

        var vehicle = ReadVehicle(connection, txn, id)
            ?? throw new InvalidOperationException("Vehicle could not be read after registration.");

        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "vehicles", id, existingId is null ? "insert" : "update",
            req.OperatorId, operatorName, vehicle);
        InsertOutbox(connection, txn, "vehicles", id, existingId is null ? "insert" : "update",
            vehicle, req.OperatorId);

        txn.Commit();
        return vehicle;
    }

    public (bool Ok, string? Error, VehicleDto? Vehicle) ArchiveVehicle(ArchiveVehicleRequest req)
    {
        EnsureInitialized();
        var normalized = NormalizePlate(req.Plate);
        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        var vehicle = FindVehicleByPlate(connection, txn, normalized);
        if (vehicle is null) return (false, "Vehicle not found", null);
        if (vehicle.Status == "archived") return (false, "Vehicle is already archived", vehicle);

        using (var open = connection.CreateCommand())
        {
            open.Transaction = txn;
            open.CommandText = """
                SELECT t.ticket_number FROM weigh_tickets t
                JOIN vehicles v ON v.id = t.vehicle_id
                WHERE t.organization_id = $org AND v.plate_normalized = $plate
                  AND t.status = 'pending' AND t.deleted_at IS NULL
                LIMIT 1;
                """;
            open.Parameters.AddWithValue("$org", _organizationId);
            open.Parameters.AddWithValue("$plate", normalized);
            var openTicket = open.ExecuteScalar();
            if (openTicket is not null)
            {
                return (false,
                    $"Vehicle has open ticket #{Convert.ToInt64(openTicket, CultureInfo.InvariantCulture)}. Complete or delete it first.",
                    vehicle);
            }
        }

        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var now = DateTimeOffset.Now.ToString("O");
        Exec(connection, txn, """
            UPDATE vehicles SET
                deleted_at = $now, deleted_by = $by, deleted_reason = $reason,
                updated_by = $by, row_version = row_version + 1, updated_at = $now
            WHERE id = $id;
            """,
            ("$id", vehicle.Id), ("$now", now), ("$by", operatorName), ("$reason", req.Reason));

        var updated = ReadVehicle(connection, txn, vehicle.Id)!;
        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "vehicles", vehicle.Id, "archive", req.OperatorId, operatorName, updated,
            before: vehicle, reason: req.Reason);
        InsertOutbox(connection, txn, "vehicles", vehicle.Id, "update", updated, req.OperatorId, req.Reason);

        txn.Commit();
        return (true, null, updated);
    }

    public VehicleDto? RestoreVehicle(ArchiveVehicleRequest req)
    {
        EnsureInitialized();
        var normalized = NormalizePlate(req.Plate);
        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        var vehicle = FindVehicleByPlate(connection, txn, normalized);
        if (vehicle is null) return null;
        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var now = DateTimeOffset.Now.ToString("O");
        Exec(connection, txn, """
            UPDATE vehicles SET
                deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL,
                updated_by = $by, row_version = row_version + 1, updated_at = $now
            WHERE id = $id;
            """,
            ("$id", vehicle.Id), ("$by", operatorName), ("$now", now));

        var updated = ReadVehicle(connection, txn, vehicle.Id)!;
        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "vehicles", vehicle.Id, "restore", req.OperatorId, operatorName, updated,
            before: vehicle, reason: req.Reason);
        InsertOutbox(connection, txn, "vehicles", vehicle.Id, "update", updated, req.OperatorId, req.Reason);
        txn.Commit();
        return updated;
    }

    public (bool Ok, string? Error) DeleteVehicle(DeleteVehicleRequest req)
    {
        EnsureInitialized();
        var normalized = NormalizePlate(req.Plate);
        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        var vehicle = FindVehicleByPlate(connection, txn, normalized);
        if (vehicle is null) return (false, "Vehicle not found");
        if (vehicle.Status != "archived")
            return (false, "Only archived vehicles can be permanently deleted.");
        if (string.IsNullOrWhiteSpace(req.Reason))
            return (false, "A deletion reason is required.");

        using (var open = connection.CreateCommand())
        {
            open.Transaction = txn;
            open.CommandText = """
                SELECT 1 FROM weigh_tickets t
                WHERE t.organization_id = $org AND t.status = 'pending' AND t.deleted_at IS NULL
                  AND (t.vehicle_id = $id OR UPPER(TRIM(t.plate_number)) = $plate)
                LIMIT 1;
                """;
            open.Parameters.AddWithValue("$org", _organizationId);
            open.Parameters.AddWithValue("$id", vehicle.Id);
            open.Parameters.AddWithValue("$plate", normalized);
            if (open.ExecuteScalar() is not null)
                return (false, "Vehicle has an open ticket. Complete or delete it first.");
        }

        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);

        Exec(connection, txn, """
            UPDATE weigh_tickets SET vehicle_id = NULL
            WHERE organization_id = $org AND vehicle_id = $id;
            """,
            ("$org", _organizationId), ("$id", vehicle.Id));
        Exec(connection, txn, """
            DELETE FROM vehicles WHERE id = $id AND organization_id = $org;
            """,
            ("$id", vehicle.Id), ("$org", _organizationId));

        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "vehicles", vehicle.Id, "hard_delete", req.OperatorId, operatorName,
            after: null, before: vehicle, reason: req.Reason);
        InsertOutbox(connection, txn, "vehicles", vehicle.Id, "delete", vehicle,
            req.OperatorId, req.Reason);

        txn.Commit();
        return (true, null);
    }

    // ---------------------------------------------------------------------
    // Tickets
    // ---------------------------------------------------------------------

    public long PeekNextTicketNumber()
    {
        EnsureInitialized();
        using var connection = OpenConnection();
        return PeekNextTicketNumber(connection, null);
    }

    public IReadOnlyList<TicketDto> GetPendingTickets()
    {
        EnsureInitialized();
        using var connection = OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT * FROM ticket_history
            WHERE organization_id = $org AND status = 'pending' AND deleted_at IS NULL
            ORDER BY created_at DESC;
            """;
        cmd.Parameters.AddWithValue("$org", _organizationId);
        var tickets = ReadTickets(connection, null, cmd);
        foreach (var ticket in tickets) FillPreviousTripStats(connection, null, ticket);
        return tickets;
    }

    public IReadOnlyList<TicketDto> GetHistory(int? limit = null, string? status = null)
    {
        EnsureInitialized();
        using var connection = OpenConnection();
        using var cmd = connection.CreateCommand();
        var filter = string.IsNullOrWhiteSpace(status)
            ? string.Empty
            : " AND status_display = $status";
        cmd.CommandText = $"""
            SELECT * FROM ticket_history
            WHERE organization_id = $org{filter}
            ORDER BY business_at DESC
            {(limit is > 0 ? "LIMIT $limit" : string.Empty)};
            """;
        cmd.Parameters.AddWithValue("$org", _organizationId);
        if (!string.IsNullOrWhiteSpace(status)) cmd.Parameters.AddWithValue("$status", status);
        if (limit is > 0) cmd.Parameters.AddWithValue("$limit", limit.Value);
        return ReadTickets(connection, null, cmd);
    }

    public TicketDto? GetTicket(long ticketNumber)
    {
        EnsureInitialized();
        using var connection = OpenConnection();
        return GetTicket(connection, null, ticketNumber);
    }

    public TicketDto CreateTicket(CreateTicketRequest req)
    {
        EnsureInitialized();
        var plate = req.TruckNo.Trim();
        var normalized = NormalizePlate(plate);
        if (plate.Length == 0) throw new InvalidOperationException("Truck number is required.");
        if (req.WeightKg < 0) throw new InvalidOperationException("Weight cannot be negative.");

        var direction = string.Equals(req.Direction, "OUT", StringComparison.OrdinalIgnoreCase) ? "OUT" : "IN";
        var firstType = string.Equals(req.FirstWeightType, "Tare", StringComparison.OrdinalIgnoreCase)
            ? "tare"
            : "gross";
        if (direction == "OUT") firstType = "tare";
        else firstType = "gross";

        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var existingOpen = FindOpenTicketNumber(connection, txn, normalized, null);
        if (existingOpen is not null)
            throw new InvalidOperationException($"Truck {plate} already has open ticket #{existingOpen.Value}.");

        var createdAt = ParseTimestamp(req.FirstTime) ?? DateTimeOffset.Now;
        var ticketId = Guid.NewGuid().ToString();
        var ticketNumber = PeekNextTicketNumber(connection, txn);
        var vehicle = UpsertVehicleForTicket(connection, txn, plate, normalized, req, operatorName);

        Exec(connection, txn, """
            INSERT INTO weigh_tickets (
                id, organization_id, site_id, weighbridge_id, workstation_id,
                ticket_number, ticket_display_id, direction, status,
                vehicle_id, plate_number, product_name, customer_name,
                driver_name, driver_phone, challan, remarks,
                first_weight_kg, first_weight_type, first_weight_at,
                first_operator_id, first_operator_name,
                created_at, created_by, updated_at, updated_by
            ) VALUES (
                $id, $org, $site, $wb, $ws,
                $number, $display, $direction, 'pending',
                $vehicle, $plate, $product, $customer,
                $driver, $phone, $challan, $remarks,
                $weight, $weightType, $weightAt,
                $opId, $opName,
                $createdAt, $opId, $createdAt, $opId
            );
            """,
            ("$id", ticketId), ("$org", _organizationId), ("$site", _siteId),
            ("$wb", _weighbridgeId), ("$ws", _workstationId),
            ("$number", ticketNumber), ("$display", ticketNumber.ToString(CultureInfo.InvariantCulture)),
            ("$direction", direction), ("$vehicle", vehicle.Id), ("$plate", plate),
            ("$product", req.Material), ("$customer", req.Client), ("$driver", req.Driver),
            ("$phone", req.Phone), ("$challan", req.Challan), ("$remarks", req.Remarks),
            ("$weight", req.WeightKg), ("$weightType", firstType),
            ("$weightAt", createdAt.ToString("O")),
            ("$opId", OperatorId(req.OperatorId)), ("$opName", operatorName),
            ("$createdAt", createdAt.ToString("O")));

        var captureId = InsertCapture(connection, txn, ticketId, 1, false, req.WeightKg,
            req.Reading, req.OperatorId, createdAt, firstType);
        Exec(connection, txn, "UPDATE weigh_tickets SET first_weight_capture_id = $capture WHERE id = $id;",
            ("$capture", captureId), ("$id", ticketId));

        if (req.RecordFirstPrint)
        {
            InsertPrintJob(connection, txn, ticketId, "first_weigh_slip", 1, false, null,
                req.OperatorId, createdAt);
        }

        var ticket = GetTicket(connection, txn, ticketNumber)
            ?? throw new InvalidOperationException("Ticket could not be read after creation.");

        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "weigh_tickets", ticketId, "insert", req.OperatorId, operatorName, ticket);
        InsertOutbox(connection, txn, "weigh_tickets", ticketId, "insert", ticket, req.OperatorId);

        txn.Commit();
        return ticket;
    }

    public TicketDto CompleteTicket(CompleteTicketRequest req)
    {
        EnsureInitialized();
        if (req.WeightKg < 0) throw new InvalidOperationException("Weight cannot be negative.");

        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        using var find = connection.CreateCommand();
        find.Transaction = txn;
        find.CommandText = """
            SELECT t.id, t.first_weight_kg, t.first_weight_type, t.status, t.deleted_at,
                   v.plate_normalized
            FROM weigh_tickets t
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.ticket_number = $number AND t.organization_id = $org;
            """;
        find.Parameters.AddWithValue("$number", req.TicketId);
        find.Parameters.AddWithValue("$org", _organizationId);

        string ticketUuid;
        double firstWeight;
        string firstType;
        string plateNormalized;
        using (var reader = find.ExecuteReader())
        {
            if (!reader.Read()) throw new InvalidOperationException($"Ticket #{req.TicketId} was not found.");
            ticketUuid = Text(reader, "id")!;
            firstWeight = Number(reader, "first_weight_kg") ?? 0;
            firstType = Text(reader, "first_weight_type") ?? "gross";
            var status = Text(reader, "status");
            var deleted = Text(reader, "deleted_at");
            plateNormalized = Text(reader, "plate_normalized") ?? "";
            if (status != "pending" || deleted is not null)
                throw new InvalidOperationException($"Ticket #{req.TicketId} is not pending.");
        }

        var secondType = firstType == "gross" ? "tare" : "gross";
        var gross = firstType == "gross" ? firstWeight : req.WeightKg;
        var tare = firstType == "tare" ? firstWeight : req.WeightKg;
        var net = gross - tare;
        if (net <= 0 && req.Override is null)
            throw new InvalidOperationException(
                "Payload anomaly detected (gross is not greater than tare). Override reason is required.");

        var completedAt = DateTimeOffset.Now;
        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var captureId = InsertCapture(connection, txn, ticketUuid, 2, true, req.WeightKg,
            req.Reading, req.OperatorId, completedAt, secondType);

        var overrideJson = req.Override is null ? null : SerializeJsonElement(req.Override.AnomalyDetails);
        var overrideAt = ParseTimestamp(req.Override?.Timestamp) ?? completedAt;

        Exec(connection, txn, """
            UPDATE weigh_tickets SET
                status = 'completed',
                second_weight_kg = $weight,
                second_weight_type = $weightType,
                second_weight_at = $weightAt,
                second_weight_capture_id = $capture,
                second_operator_id = $opId,
                second_operator_name = $opName,
                gross_weight_kg = $gross,
                tare_weight_kg = $tare,
                net_weight_kg = $net,
                is_overridden = $overridden,
                override_reason = $overrideReason,
                override_operator_id = $overrideOpId,
                override_operator_name = $overrideOpName,
                override_anomaly_details = $overrideDetails,
                override_at = $overrideAt,
                completed_at = $completedAt,
                updated_at = $completedAt,
                updated_by = $opId,
                row_version = row_version + 1
            WHERE id = $id;
            """,
            ("$id", ticketUuid), ("$weight", req.WeightKg), ("$weightType", secondType),
            ("$weightAt", completedAt.ToString("O")), ("$capture", captureId),
            ("$opId", OperatorId(req.OperatorId)), ("$opName", operatorName),
            ("$gross", gross), ("$tare", tare), ("$net", net),
            ("$overridden", req.Override is null ? 0 : 1),
            ("$overrideReason", (object?)req.Override?.Reason ?? DBNull.Value),
            ("$overrideOpId", (object?)req.Override?.Operator ?? DBNull.Value),
            ("$overrideOpName", (object?)req.Override?.Operator ?? DBNull.Value),
            ("$overrideDetails", (object?)overrideJson ?? DBNull.Value),
            ("$overrideAt", req.Override is null ? DBNull.Value : overrideAt.ToString("O")),
            ("$completedAt", completedAt.ToString("O")));

        if (req.RecordCertificatePrint)
        {
            InsertPrintJob(connection, txn, ticketUuid, "weighbridge_certificate", 1, false, null,
                req.OperatorId, completedAt);
        }

        UpdateVehicleStatsAfterCompletion(connection, txn, plateNormalized, tare, completedAt);

        var ticket = GetTicket(connection, txn, req.TicketId)
            ?? throw new InvalidOperationException("Ticket could not be read after completion.");

        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "weigh_tickets", ticketUuid, "complete", req.OperatorId, operatorName, ticket,
            reason: req.Override?.Reason);
        InsertOutbox(connection, txn, "weigh_tickets", ticketUuid, "update", ticket,
            req.OperatorId, req.Override?.Reason);

        txn.Commit();
        return ticket;
    }

    public TicketDto VoidTicket(TicketReasonRequest req)
    {
        EnsureInitialized();
        if (string.IsNullOrWhiteSpace(req.Reason))
            throw new InvalidOperationException("A void reason is required.");

        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        var ticket = GetTicketByNumber(connection, txn, req.TicketId);
        if (ticket is null) throw new InvalidOperationException($"Ticket #{req.TicketId} was not found.");
        if (ticket.Status != "completed")
            throw new InvalidOperationException("Only completed tickets can be voided.");

        var now = DateTimeOffset.Now;
        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);

        Exec(connection, txn, """
            UPDATE weigh_tickets SET
                status = 'voided', voided_at = $now, voided_by = $by, voided_reason = $reason,
                updated_at = $now, updated_by = $opId, row_version = row_version + 1
            WHERE id = $id AND status = 'completed';
            """,
            ("$id", ticket.Uuid), ("$now", now.ToString("O")), ("$by", operatorName),
            ("$reason", req.Reason), ("$opId", OperatorId(req.OperatorId)));

        using (var correction = connection.CreateCommand())
        {
            correction.Transaction = txn;
            correction.CommandText = """
                INSERT INTO ticket_corrections (
                    id, ticket_id, organization_id, correction_type, field_changed,
                    old_value, new_value, reason, requested_by, requested_at,
                    approved_by, approved_at, approval_status
                ) VALUES (
                    $id, $ticket, $org, 'void', 'status', 'completed', 'voided',
                    $reason, $by, $now, $by, $now, 'approved'
                );
                """;
            correction.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
            correction.Parameters.AddWithValue("$ticket", ticket.Uuid);
            correction.Parameters.AddWithValue("$org", _organizationId);
            correction.Parameters.AddWithValue("$reason", req.Reason);
            correction.Parameters.AddWithValue("$by", OperatorId(req.OperatorId));
            correction.Parameters.AddWithValue("$now", now.ToString("O"));
            correction.ExecuteNonQuery();
        }

        UpdateVehicleStatsAfterVoid(connection, txn, ticket.PlateNormalized);

        var updated = GetTicket(connection, txn, req.TicketId)!;
        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "weigh_tickets", ticket.Uuid, "void", req.OperatorId, operatorName, updated,
            before: ticket.Dto, reason: req.Reason);
        InsertOutbox(connection, txn, "weigh_tickets", ticket.Uuid, "update", updated,
            req.OperatorId, req.Reason);

        txn.Commit();
        return updated;
    }

    public TicketDto SoftDeleteTicket(TicketReasonRequest req)
    {
        EnsureInitialized();
        if (string.IsNullOrWhiteSpace(req.Reason))
            throw new InvalidOperationException("A delete reason is required.");

        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        var ticket = GetTicketByNumber(connection, txn, req.TicketId);
        if (ticket is null) throw new InvalidOperationException($"Ticket #{req.TicketId} was not found.");
        if (ticket.Status != "pending")
            throw new InvalidOperationException("Only pending tickets can be deleted.");

        var now = DateTimeOffset.Now;
        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        Exec(connection, txn, """
            UPDATE weigh_tickets SET
                deleted_at = $now, deleted_by = $by, deleted_reason = $reason,
                updated_at = $now, updated_by = $opId, row_version = row_version + 1
            WHERE id = $id AND status = 'pending' AND deleted_at IS NULL;
            """,
            ("$id", ticket.Uuid), ("$now", now.ToString("O")), ("$by", operatorName),
            ("$reason", req.Reason), ("$opId", OperatorId(req.OperatorId)));

        var updated = GetTicket(connection, txn, req.TicketId)!;
        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "weigh_tickets", ticket.Uuid, "soft_delete", req.OperatorId, operatorName, updated,
            before: ticket.Dto, reason: req.Reason);
        InsertOutbox(connection, txn, "weigh_tickets", ticket.Uuid, "delete", updated,
            req.OperatorId, req.Reason);

        txn.Commit();
        return updated;
    }

    public (TicketDto Ticket, int CopyNumber) RecordReprint(ReprintRequest req)
    {
        EnsureInitialized();
        if (string.IsNullOrWhiteSpace(req.Reason))
            throw new InvalidOperationException("A reprint reason is required.");

        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();

        var ticket = GetTicketByNumber(connection, txn, req.TicketId)
            ?? throw new InvalidOperationException($"Ticket #{req.TicketId} was not found.");
        var documentType = req.DocumentType is "first_weigh_slip" or "weighbridge_certificate"
            ? req.DocumentType
            : ticket.Status is "completed" or "voided"
                ? "weighbridge_certificate"
                : "first_weigh_slip";

        int nextCopy;
        using (var copy = connection.CreateCommand())
        {
            copy.Transaction = txn;
            copy.CommandText = """
                SELECT COALESCE(MAX(copy_number), 0) + 1 FROM print_jobs
                WHERE ticket_id = $ticket AND document_type = $type;
                """;
            copy.Parameters.AddWithValue("$ticket", ticket.Uuid);
            copy.Parameters.AddWithValue("$type", documentType);
            nextCopy = Convert.ToInt32(copy.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        var operatorName = ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        InsertPrintJob(connection, txn, ticket.Uuid, documentType, nextCopy, true, req.Reason,
            req.OperatorId, DateTimeOffset.Now);

        var updated = GetTicket(connection, txn, req.TicketId)!;
        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "print_jobs", $"{ticket.Uuid}:{documentType}:{nextCopy}", "reprint",
            req.OperatorId, operatorName,
            new { ticketId = req.TicketId, documentType, copyNumber = nextCopy, reason = req.Reason },
            reason: req.Reason);
        InsertOutbox(connection, txn, "weigh_tickets", ticket.Uuid, "update", updated,
            req.OperatorId, req.Reason);

        txn.Commit();
        return (updated, nextCopy);
    }

    public PrintJobRecord RecordPrintJob(long ticketNumber, string? documentType, string operatorId,
        string operatorName, string? reason = null)
    {
        EnsureInitialized();
        using var connection = OpenConnection();
        using var txn = connection.BeginTransaction();
        var ticket = GetTicketByNumber(connection, txn, ticketNumber)
            ?? throw new InvalidOperationException($"Ticket #{ticketNumber} was not found.");
        var type = documentType is "first_weigh_slip" or "weighbridge_certificate"
            ? documentType
            : ticket.Status is "completed" or "voided" ? "weighbridge_certificate" : "first_weigh_slip";

        int copy;
        using (var cmd = connection.CreateCommand())
        {
            cmd.Transaction = txn;
            cmd.CommandText = """
                SELECT COALESCE(MAX(copy_number), 0) + 1 FROM print_jobs
                WHERE ticket_id = $ticket AND document_type = $type;
                """;
            cmd.Parameters.AddWithValue("$ticket", ticket.Uuid);
            cmd.Parameters.AddWithValue("$type", type);
            copy = Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        var jobId = InsertPrintJob(connection, txn, ticket.Uuid, type, copy, copy > 1,
            copy > 1 ? reason : null, operatorId, DateTimeOffset.Now);
        var name = ResolveOperatorName(connection, txn, operatorId, operatorName);
        _audit.InsertMutation(connection, txn, _organizationId, _workstationId,
            "print_jobs", jobId, "print", operatorId, name,
            new { ticketId = ticketNumber, documentType = type, copyNumber = copy, reason },
            reason: reason);
        txn.Commit();
        return new PrintJobRecord(jobId, type, copy);
    }

    public SyncStatusDto GetSyncStatus()
    {
        EnsureInitialized();
        using var connection = OpenConnection();
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

    public void RecordScaleHealth(string eventType, string details, DateTimeOffset? at = null)
    {
        EnsureInitialized();
        using var connection = OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO scale_health_events (
                id, organization_id, workstation_id, weighbridge_id,
                event_type, details, occurred_at
            ) VALUES ($id, $org, $ws, $wb, $type, $details, $at);
            """;
        cmd.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
        cmd.Parameters.AddWithValue("$org", _organizationId);
        cmd.Parameters.AddWithValue("$ws", _workstationId);
        cmd.Parameters.AddWithValue("$wb", _weighbridgeId);
        cmd.Parameters.AddWithValue("$type", eventType);
        cmd.Parameters.AddWithValue("$details", details);
        cmd.Parameters.AddWithValue("$at", (at ?? DateTimeOffset.Now).ToString("O"));
        cmd.ExecuteNonQuery();
    }

    // ---------------------------------------------------------------------
    // Ticket internals
    // ---------------------------------------------------------------------

    private long PeekNextTicketNumber(SqliteConnection connection, SqliteTransaction? txn)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT COALESCE(MAX(ticket_number), $fallback) + 1
            FROM weigh_tickets WHERE organization_id = $org;
            """;
        cmd.Parameters.AddWithValue("$fallback", LastHistoricalTicketNumber);
        cmd.Parameters.AddWithValue("$org", _organizationId);
        return Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private long? FindOpenTicketNumber(SqliteConnection connection, SqliteTransaction txn,
        string normalizedPlate, string? excludeTicketId)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT t.ticket_number FROM weigh_tickets t
            JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.organization_id = $org AND v.plate_normalized = $plate
              AND t.status = 'pending' AND t.deleted_at IS NULL
              AND ($exclude IS NULL OR t.id <> $exclude)
            LIMIT 1;
            """;
        cmd.Parameters.AddWithValue("$org", _organizationId);
        cmd.Parameters.AddWithValue("$plate", normalizedPlate);
        cmd.Parameters.AddWithValue("$exclude", (object?)excludeTicketId ?? DBNull.Value);
        var result = cmd.ExecuteScalar();
        return result is null ? null : Convert.ToInt64(result, CultureInfo.InvariantCulture);
    }

    private VehicleDto UpsertVehicleForTicket(SqliteConnection connection, SqliteTransaction txn,
        string plate, string normalized, CreateTicketRequest req, string operatorName)
    {
        var existing = FindVehicleByPlate(connection, txn, normalized);
        if (existing is null)
        {
            var id = Guid.NewGuid().ToString();
            var now = DateTimeOffset.Now.ToString("O");
            Exec(connection, txn, """
                INSERT INTO vehicles (
                    id, organization_id, plate_number, plate_normalized,
                    default_driver_name, default_driver_phone, default_client,
                    default_material, registered_by, created_at, updated_at
                ) VALUES ($id, $org, $plate, $normalized, $driver, $phone, $client, $material, $by, $now, $now);
                """,
                ("$id", id), ("$org", _organizationId), ("$plate", plate),
                ("$normalized", normalized), ("$driver", req.Driver), ("$phone", req.Phone),
                ("$client", req.Client), ("$material", req.Material), ("$by", operatorName),
                ("$now", now));
            return ReadVehicle(connection, txn, id)!;
        }

        Exec(connection, txn, """
            UPDATE vehicles SET
                default_driver_name = CASE WHEN $driver = '' THEN default_driver_name ELSE $driver END,
                default_driver_phone = CASE WHEN $phone = '' THEN default_driver_phone ELSE $phone END,
                default_client = CASE WHEN $client = '' THEN default_client ELSE $client END,
                default_material = CASE WHEN $material = '' THEN default_material ELSE $material END,
                updated_by = $by,
                row_version = row_version + 1,
                updated_at = $now
            WHERE id = $id;
            """,
            ("$id", existing.Id), ("$driver", req.Driver), ("$phone", req.Phone),
            ("$client", req.Client), ("$material", req.Material), ("$by", operatorName),
            ("$now", DateTimeOffset.Now.ToString("O")));
        return ReadVehicle(connection, txn, existing.Id)!;
    }

    private string InsertCapture(SqliteConnection connection, SqliteTransaction txn,
        string ticketUuid, int sequence, bool isFinal, double fallbackWeight,
        WeightReading? reading, string operatorId, DateTimeOffset capturedAt, string weightType)
    {
        var id = Guid.NewGuid().ToString();
        var weight = reading?.WeightKg ?? fallbackWeight;
        var rawDigits = reading?.RawDigits;
        if (string.IsNullOrWhiteSpace(rawDigits))
            rawDigits = Math.Abs(weight).ToString("0", CultureInfo.InvariantCulture);
        var sign = reading?.Sign ?? (weight < 0 ? "-" : "+");
        var decimalCount = reading?.DecimalCount ?? 0;
        var source = reading?.Source ?? "manual";
        var rawHex = reading?.RawFrameHex ?? "";
        var checksumValid = reading?.ChecksumValid ?? false;

        Exec(connection, txn, """
            INSERT INTO weight_captures (
                id, ticket_id, organization_id, capture_sequence, is_final,
                weight_kg, weight_raw_digits, weight_sign, decimal_count, unit,
                raw_frame_hex, checksum_valid, checksum_expected, checksum_actual,
                is_stable, stability_variance, stability_window_ms, stability_sample_count,
                connection_profile_id, connection_profile_version, source, workstation_id,
                operator_id, captured_at
            ) VALUES (
                $id, $ticket, $org, $seq, $final,
                $weight, $digits, $sign, $decimals, 'kg',
                $hex, $checksum, $expected, $actual,
                $stable, $variance, $window, $samples,
                $profile, 1, $source, $ws,
                $op, $at
            );
            """,
            ("$id", id), ("$ticket", ticketUuid), ("$org", _organizationId),
            ("$seq", sequence), ("$final", isFinal ? 1 : 0),
            ("$weight", weight), ("$digits", rawDigits), ("$sign", sign),
            ("$decimals", decimalCount), ("$hex", rawHex), ("$checksum", checksumValid ? 1 : 0),
            ("$expected", (object?)reading?.ChecksumExpected ?? DBNull.Value),
            ("$actual", (object?)reading?.ChecksumActual ?? DBNull.Value),
            ("$stable", reading?.IsStable == true ? 1 : 0),
            ("$variance", (object?)reading?.StabilityVariance ?? DBNull.Value),
            ("$window", (object?)reading?.StabilityWindowMs ?? DBNull.Value),
            ("$samples", (object?)reading?.StabilitySampleCount ?? DBNull.Value),
            ("$profile", _scaleProfileId), ("$source", source), ("$ws", _workstationId),
            ("$op", OperatorId(operatorId)), ("$at", capturedAt.ToString("O")));
        return id;
    }

    private string InsertPrintJob(SqliteConnection connection, SqliteTransaction txn,
        string ticketUuid, string documentType, int copyNumber, bool isReprint,
        string? reason, string operatorId, DateTimeOffset printedAt)
    {
        var id = Guid.NewGuid().ToString();
        Exec(connection, txn, """
            INSERT INTO print_jobs (
                id, ticket_id, organization_id, document_type, is_reprint,
                copy_number, reprint_reason, template_version, printed_by,
                printed_at, workstation_id
            ) VALUES (
                $id, $ticket, $org, $type, $reprint,
                $copy, $reason, 'v1', $by,
                $at, $ws
            );
            """,
            ("$id", id), ("$ticket", ticketUuid), ("$org", _organizationId),
            ("$type", documentType), ("$reprint", isReprint ? 1 : 0), ("$copy", copyNumber),
            ("$reason", (object?)reason ?? DBNull.Value), ("$by", OperatorId(operatorId)),
            ("$at", printedAt.ToString("O")), ("$ws", _workstationId));
        return id;
    }

    private void UpdateVehicleStatsAfterCompletion(SqliteConnection connection, SqliteTransaction txn,
        string normalizedPlate, double tare, DateTimeOffset completedAt)
    {
        Exec(connection, txn, """
            UPDATE vehicles SET
                trip_count = trip_count + 1,
                last_weighed_at = $at,
                last_tare_kg = $tare,
                row_version = row_version + 1,
                updated_at = $at
            WHERE organization_id = $org AND plate_normalized = $plate;
            """,
            ("$org", _organizationId), ("$plate", normalizedPlate),
            ("$tare", tare), ("$at", completedAt.ToString("O")));
    }

    private void UpdateVehicleStatsAfterVoid(SqliteConnection connection, SqliteTransaction txn,
        string normalizedPlate)
    {
        double? lastTare = null;
        string? lastAt = null;
        using (var cmd = connection.CreateCommand())
        {
            cmd.Transaction = txn;
            cmd.CommandText = """
                SELECT t.tare_weight_kg, t.completed_at FROM weigh_tickets t
                JOIN vehicles v ON v.id = t.vehicle_id
                WHERE t.organization_id = $org AND v.plate_normalized = $plate
                  AND t.status = 'completed' AND t.deleted_at IS NULL
                ORDER BY t.completed_at DESC LIMIT 1;
                """;
            cmd.Parameters.AddWithValue("$org", _organizationId);
            cmd.Parameters.AddWithValue("$plate", normalizedPlate);
            using var reader = cmd.ExecuteReader();
            if (reader.Read())
            {
                lastTare = Number(reader, "tare_weight_kg");
                lastAt = Text(reader, "completed_at");
            }
        }

        Exec(connection, txn, """
            UPDATE vehicles SET
                trip_count = CASE WHEN trip_count > 0 THEN trip_count - 1 ELSE 0 END,
                last_weighed_at = $at,
                last_tare_kg = $tare,
                row_version = row_version + 1,
                updated_at = $now
            WHERE organization_id = $org AND plate_normalized = $plate;
            """,
            ("$org", _organizationId), ("$plate", normalizedPlate),
            ("$at", (object?)lastAt ?? DBNull.Value),
            ("$tare", (object?)lastTare ?? DBNull.Value),
            ("$now", DateTimeOffset.Now.ToString("O")));
    }

    private TicketRecord? GetTicketByNumber(SqliteConnection connection, SqliteTransaction? txn, long number)
    {
        var dto = GetTicket(connection, txn, number);
        if (dto is null) return null;
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT t.id, v.plate_normalized FROM weigh_tickets t
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.ticket_number = $n AND t.organization_id = $org;
            """;
        cmd.Parameters.AddWithValue("$n", number);
        cmd.Parameters.AddWithValue("$org", _organizationId);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return null;
        return new TicketRecord(Text(reader, "id")!, Text(reader, "plate_normalized") ?? "", dto);
    }

    private TicketDto? GetTicket(SqliteConnection connection, SqliteTransaction? txn, long number)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT * FROM ticket_history
            WHERE organization_id = $org AND ticket_number = $number;
            """;
        cmd.Parameters.AddWithValue("$org", _organizationId);
        cmd.Parameters.AddWithValue("$number", number);
        var list = ReadTickets(connection, txn, cmd);
        return list.Count == 0 ? null : list[0];
    }

    private IReadOnlyList<TicketDto> ReadTickets(SqliteConnection connection, SqliteTransaction? txn,
        SqliteCommand cmd)
    {
        var results = new List<TicketDto>();
        using (var reader = cmd.ExecuteReader())
        {
            while (reader.Read())
            {
                results.Add(MapTicket(reader));
            }
        }

        foreach (var dto in results)
        {
            dto.PrintLog = ReadPrintLog(connection, txn, dto.TicketUuid!);
        }
        return results;
    }

    private List<PrintLogEntryDto> ReadPrintLog(SqliteConnection connection, SqliteTransaction? txn,
        string ticketUuid)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT p.document_type, p.is_reprint, p.copy_number, p.reprint_reason,
                   p.printed_at, COALESCE(pr.display_name, p.printed_by) AS printed_by
            FROM print_jobs p
            LEFT JOIN profiles pr ON pr.id = p.printed_by
            WHERE p.ticket_id = $ticket
            ORDER BY p.printed_at, p.copy_number;
            """;
        cmd.Parameters.AddWithValue("$ticket", ticketUuid);

        var list = new List<PrintLogEntryDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var reprint = Number(reader, "is_reprint") == 1;
            list.Add(new PrintLogEntryDto
            {
                By = Text(reader, "printed_by") ?? "Unknown",
                At = Text(reader, "printed_at") ?? "",
                Type = reprint ? "reprint" : Text(reader, "document_type") ?? "first_weigh_slip",
                Reason = Text(reader, "reprint_reason"),
                CopyNumber = (int?)Number(reader, "copy_number"),
            });
        }
        return list;
    }

    private void FillPreviousTripStats(SqliteConnection connection, SqliteTransaction? txn, TicketDto ticket)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT t.gross_weight_kg, t.tare_weight_kg, t.net_weight_kg, t.completed_at
            FROM weigh_tickets t
            JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.organization_id = $org AND v.plate_normalized = $plate
              AND t.status = 'completed' AND t.deleted_at IS NULL
              AND t.ticket_number <> $number
            ORDER BY t.completed_at DESC LIMIT 1;
            """;
        cmd.Parameters.AddWithValue("$org", _organizationId);
        cmd.Parameters.AddWithValue("$plate", NormalizePlate(ticket.TruckNo));
        cmd.Parameters.AddWithValue("$number", ticket.Id);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return;
        ticket.LastGross = Number(reader, "gross_weight_kg");
        ticket.LastTare = Number(reader, "tare_weight_kg");
        ticket.LastPayload = Number(reader, "net_weight_kg");
        var at = ParseTimestamp(Text(reader, "completed_at"));
        ticket.LastWeighAt = at?.ToString("dd MMM", CultureInfo.InvariantCulture);
    }

    private TicketDto MapTicket(SqliteDataReader reader)
    {
        var direction = Text(reader, "direction") ?? "IN";
        var createdAt = ParseTimestamp(Text(reader, "created_at"));
        var firstWeight = Number(reader, "first_weight_kg");
        var firstType = Text(reader, "first_weight_type");
        var statusDisplay = Text(reader, "status_display") ?? Text(reader, "status") ?? "pending";
        var overrideDetails = Text(reader, "override_anomaly_details");
        var overridden = Number(reader, "is_overridden") == 1;

        var dto = new TicketDto
        {
            TicketUuid = Text(reader, "id"),
            Id = Convert.ToInt64(Number(reader, "ticket_number") ?? 0),
            TicketDisplayId = Text(reader, "ticket_display_id") ?? "",
            TruckNo = Text(reader, "plate_number") ?? "",
            Driver = Text(reader, "driver_name") ?? "",
            Phone = Text(reader, "driver_phone") ?? "",
            Material = Text(reader, "product_name") ?? "",
            Client = Text(reader, "customer_name") ?? "",
            Challan = Text(reader, "challan") ?? "",
            Remarks = Text(reader, "remarks") ?? "",
            Direction = direction,
            WeightType = direction == "OUT" ? "OUT WEIGHT" : "IN WEIGHT",
            Status = statusDisplay,
            Deleted = statusDisplay == "deleted",
            FirstWeight = firstWeight,
            FirstWeightType = TitleCase(firstType),
            FirstWeightTime = FormatTimestamp(createdAt),
            FirstOperator = Text(reader, "first_operator_name"),
            SecondWeight = Number(reader, "second_weight_kg"),
            SecondWeightType = TitleCase(Text(reader, "second_weight_type")),
            SecondWeightTime = FormatTimestamp(ParseTimestamp(Text(reader, "second_weight_at"))),
            SecondOperator = Text(reader, "second_operator_name"),
            GrossWeight = Number(reader, "gross_weight_kg"),
            TareWeight = Number(reader, "tare_weight_kg"),
            NetWeight = Number(reader, "net_weight_kg"),
            CreatedAt = createdAt?.ToString("O"),
            CompletedAt = Text(reader, "completed_at"),
            SecondCompletedAt = ParseTimestamp(Text(reader, "completed_at")),
            VoidedAt = Text(reader, "voided_at"),
            VoidedBy = Text(reader, "voided_by"),
            VoidedReason = Text(reader, "voided_reason"),
            DeletedAt = Text(reader, "deleted_at"),
            DeletedBy = Text(reader, "deleted_by"),
            DeletedReason = Text(reader, "deleted_reason"),
            TimeElapsed = FormatElapsed(createdAt),
            Override = overridden
                ? new TicketOverrideDto
                {
                    Reason = Text(reader, "override_reason") ?? "",
                    Operator = Text(reader, "override_operator_name") ?? "",
                    Timestamp = FormatTimestamp(ParseTimestamp(Text(reader, "override_at"))),
                    AnomalyDetails = overrideDetails,
                }
                : null,
            PrintCount = (int)(Number(reader, "print_count") ?? 0),
            FirstOperatorAvatar = Text(reader, "first_operator_avatar"),
            SecondOperatorAvatar = Text(reader, "second_operator_avatar"),
        };

        return dto;
    }

    private VehicleDto? FindVehicleByPlate(SqliteConnection connection, SqliteTransaction txn,
        string normalizedPlate)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = "SELECT id FROM vehicles WHERE organization_id = $org AND plate_normalized = $plate;";
        cmd.Parameters.AddWithValue("$org", _organizationId);
        cmd.Parameters.AddWithValue("$plate", normalizedPlate);
        var id = cmd.ExecuteScalar() as string;
        return id is null ? null : ReadVehicle(connection, txn, id);
    }

    private VehicleDto? ReadVehicle(SqliteConnection connection, SqliteTransaction txn, string id)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = "SELECT * FROM vehicles WHERE id = $id;";
        cmd.Parameters.AddWithValue("$id", id);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? MapVehicle(reader) : null;
    }

    private static VehicleDto MapVehicle(SqliteDataReader reader)
    {
        var deletedAt = ParseTimestamp(Text(reader, "deleted_at"));
        return new VehicleDto
        {
            Id = Text(reader, "id") ?? "",
            Plate = Text(reader, "plate_number") ?? "",
            Driver = Text(reader, "default_driver_name") ?? "",
            Phone = Text(reader, "default_driver_phone") ?? "",
            Material = Text(reader, "default_material") ?? "",
            Client = Text(reader, "default_client") ?? "",
            Status = deletedAt is null ? "active" : "archived",
            TripCount = (int)(Number(reader, "trip_count") ?? 0),
            LastTare = Number(reader, "last_tare_kg"),
            LastWeighed = ParseTimestamp(Text(reader, "last_weighed_at")),
            ArchivedAt = deletedAt,
            ArchivedBy = Text(reader, "deleted_by"),
            ArchivedReason = Text(reader, "deleted_reason"),
            RegisteredBy = Text(reader, "registered_by"),
            RegisteredAt = ParseTimestamp(Text(reader, "created_at")),
            Notes = Text(reader, "notes"),
        };
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private string ResolveOperatorName(SqliteConnection connection, SqliteTransaction txn,
        string operatorId, string fallback)
    {
        if (!string.IsNullOrWhiteSpace(operatorId))
        {
            using var cmd = connection.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = "SELECT display_name FROM profiles WHERE id = $id;";
            cmd.Parameters.AddWithValue("$id", operatorId);
            if (cmd.ExecuteScalar() is string name && name.Length > 0) return name;
        }
        return string.IsNullOrWhiteSpace(fallback) ? "Unknown Operator" : fallback;
    }

    private static string OperatorId(string? id) =>
        string.IsNullOrWhiteSpace(id) ? "system" : id;

    private void InsertOutbox(SqliteConnection connection, SqliteTransaction txn,
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

        Exec(connection, txn, """
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
            ("$payload", JsonSerializer.Serialize(payload, Json)),
            ("$ws", _workstationId), ("$op", OperatorId(operatorId)),
            ("$reason", (object?)reason ?? DBNull.Value),
            ("$now", DateTimeOffset.Now.ToString("O")));
    }

    private static void Exec(SqliteConnection connection, SqliteTransaction? txn,
        string sql, params (string Name, object? Value)[] parameters)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }
        cmd.ExecuteNonQuery();
    }

    private static string? Text(SqliteDataReader reader, string name)
    {
        var i = reader.GetOrdinal(name);
        return reader.IsDBNull(i) ? null : Convert.ToString(reader.GetValue(i), CultureInfo.InvariantCulture);
    }

    private static double? Number(SqliteDataReader reader, string name)
    {
        var i = reader.GetOrdinal(name);
        return reader.IsDBNull(i) ? null : Convert.ToDouble(reader.GetValue(i), CultureInfo.InvariantCulture);
    }

    private static string TitleCase(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        return char.ToUpperInvariant(value[0]) + value[1..].ToLowerInvariant();
    }

    public static string NormalizePlate(string plate) =>
        string.Join(' ', plate.Trim().ToUpperInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));

    private static string StableId(string kind, string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{kind}:{value}"));
        return new Guid(bytes.AsSpan(0, 16)).ToString();
    }

    private static DateTimeOffset? ParseTimestamp(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateTimeOffset.TryParseExact(value, WebUiTimestampFormats, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal | DateTimeStyles.AllowWhiteSpaces, out var webUiParsed))
        {
            return webUiParsed;
        }
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out var parsed))
        {
            return parsed;
        }
        return null;
    }

    public static string FormatTimestamp(DateTimeOffset? value) =>
        value?.ToLocalTime().ToString("dd-MM-yy hh:mm:ss tt", CultureInfo.InvariantCulture) ?? "";

    private static string FormatElapsed(DateTimeOffset? createdAt)
    {
        if (createdAt is null) return "";
        var span = DateTimeOffset.Now - createdAt.Value;
        if (span.TotalMinutes < 1) return "Just now";
        if (span.TotalMinutes < 60) return $"{Math.Max(1, (int)span.TotalMinutes)} mins";
        if (span.TotalHours < 24) return $"{span.TotalHours:0.#} hrs";
        return $"{Math.Max(1, (int)span.TotalDays)} days";
    }

    private static string? SerializeJsonElement(JsonElement? element)
    {
        if (element is null || element.Value.ValueKind == JsonValueKind.Null) return null;
        return element.Value.ValueKind == JsonValueKind.String
            ? element.Value.GetString()
            : element.Value.GetRawText();
    }

    private sealed record TicketRecord(string Uuid, string PlateNormalized, TicketDto Dto)
    {
        public string Status => Dto.Status;
    }
}

public sealed record PrintJobRecord(string Id, string DocumentType, int CopyNumber);
