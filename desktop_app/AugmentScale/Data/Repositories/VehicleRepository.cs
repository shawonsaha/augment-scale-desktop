using System.Globalization;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data.Repositories;

internal sealed class VehicleRepository : IVehicleRepository
{
    private readonly DatabaseContext _db;

    public VehicleRepository(DatabaseContext db)
    {
        _db = db;
    }

    public IReadOnlyList<VehicleDto> GetVehicles()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetVehicles(connection);
    }

    internal IReadOnlyList<VehicleDto> GetVehicles(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT * FROM vehicles
            WHERE organization_id = $org
            ORDER BY (deleted_at IS NOT NULL), last_weighed_at DESC, created_at DESC;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);

        var results = new List<VehicleDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) results.Add(MapVehicle(reader));
        return results;
    }

    public IReadOnlyList<VehicleDto> GetActiveVehicles()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetActiveVehicles(connection);
    }

    internal IReadOnlyList<VehicleDto> GetActiveVehicles(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT * FROM vehicles
            WHERE organization_id = $org AND deleted_at IS NULL
            ORDER BY last_weighed_at DESC, created_at DESC;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);

        var results = new List<VehicleDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) results.Add(MapVehicle(reader));
        return results;
    }

    public VehicleDto RegisterVehicle(VehicleRequest req)
    {
        _db.EnsureInitialized();
        var plate = req.Plate.Trim();
        if (plate.Length == 0) throw new InvalidOperationException("Truck number is required.");
        var normalized = SqliteHelpers.NormalizePlate(plate);
        var now = DateTimeOffset.Now;

        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();

        string? existingId = null;
        using (var find = connection.CreateCommand())
        {
            find.Transaction = txn;
            find.CommandText = "SELECT id FROM vehicles WHERE organization_id = $org AND plate_normalized = $plate;";
            find.Parameters.AddWithValue("$org", _db.OrganizationId);
            find.Parameters.AddWithValue("$plate", normalized);
            existingId = find.ExecuteScalar() as string;
        }

        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var id = existingId ?? Guid.NewGuid().ToString();

        if (existingId is null)
        {
            SqliteHelpers.Exec(connection, txn, """
                INSERT INTO vehicles (
                    id, organization_id, plate_number, plate_normalized,
                    default_driver_name, default_driver_phone, default_client,
                    default_material, registered_by, created_at, updated_at
                ) VALUES ($id, $org, $plate, $normalized, $driver, $phone, $client, $material, $by, $now, $now);
                """,
                ("$id", id), ("$org", _db.OrganizationId), ("$plate", plate),
                ("$normalized", normalized), ("$driver", req.Driver), ("$phone", req.Phone),
                ("$client", req.Client), ("$material", req.Material), ("$by", operatorName),
                ("$now", now.ToString("O")));
        }
        else
        {
            SqliteHelpers.Exec(connection, txn, """
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

        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "vehicles", id, existingId is null ? "insert" : "update",
            req.OperatorId, operatorName, vehicle);
        _db.InsertOutbox(connection, txn, "vehicles", id, existingId is null ? "insert" : "update",
            vehicle, req.OperatorId);

        txn.Commit();
        return vehicle;
    }

    public (bool Ok, string? Error, VehicleDto? Vehicle) ArchiveVehicle(ArchiveVehicleRequest req)
    {
        _db.EnsureInitialized();
        var normalized = SqliteHelpers.NormalizePlate(req.Plate);
        using var connection = _db.OpenConnection();
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
            open.Parameters.AddWithValue("$org", _db.OrganizationId);
            open.Parameters.AddWithValue("$plate", normalized);
            var openTicket = open.ExecuteScalar();
            if (openTicket is not null)
            {
                return (false,
                    $"Vehicle has open ticket #{Convert.ToInt64(openTicket, CultureInfo.InvariantCulture)}. Complete or delete it first.",
                    vehicle);
            }
        }

        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var now = DateTimeOffset.Now.ToString("O");
        SqliteHelpers.Exec(connection, txn, """
            UPDATE vehicles SET
                deleted_at = $now, deleted_by = $by, deleted_reason = $reason,
                updated_by = $by, row_version = row_version + 1, updated_at = $now
            WHERE id = $id;
            """,
            ("$id", vehicle.Id), ("$now", now), ("$by", operatorName), ("$reason", req.Reason));

        var updated = ReadVehicle(connection, txn, vehicle.Id)!;
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "vehicles", vehicle.Id, "archive", req.OperatorId, operatorName, updated,
            before: vehicle, reason: req.Reason);
        _db.InsertOutbox(connection, txn, "vehicles", vehicle.Id, "update", updated,
            req.OperatorId, req.Reason);

        txn.Commit();
        return (true, null, updated);
    }

    public VehicleDto? RestoreVehicle(ArchiveVehicleRequest req)
    {
        _db.EnsureInitialized();
        var normalized = SqliteHelpers.NormalizePlate(req.Plate);
        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();

        var vehicle = FindVehicleByPlate(connection, txn, normalized);
        if (vehicle is null) return null;
        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var now = DateTimeOffset.Now.ToString("O");
        SqliteHelpers.Exec(connection, txn, """
            UPDATE vehicles SET
                deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL,
                updated_by = $by, row_version = row_version + 1, updated_at = $now
            WHERE id = $id;
            """,
            ("$id", vehicle.Id), ("$by", operatorName), ("$now", now));

        var updated = ReadVehicle(connection, txn, vehicle.Id)!;
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "vehicles", vehicle.Id, "restore", req.OperatorId, operatorName, updated,
            before: vehicle, reason: req.Reason);
        _db.InsertOutbox(connection, txn, "vehicles", vehicle.Id, "update", updated,
            req.OperatorId, req.Reason);
        txn.Commit();
        return updated;
    }

    public (bool Ok, string? Error) DeleteVehicle(DeleteVehicleRequest req)
    {
        _db.EnsureInitialized();
        var normalized = SqliteHelpers.NormalizePlate(req.Plate);
        using var connection = _db.OpenConnection();
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
            open.Parameters.AddWithValue("$org", _db.OrganizationId);
            open.Parameters.AddWithValue("$id", vehicle.Id);
            open.Parameters.AddWithValue("$plate", normalized);
            if (open.ExecuteScalar() is not null)
                return (false, "Vehicle has an open ticket. Complete or delete it first.");
        }

        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);

        SqliteHelpers.Exec(connection, txn, """
            UPDATE weigh_tickets SET vehicle_id = NULL
            WHERE organization_id = $org AND vehicle_id = $id;
            """,
            ("$org", _db.OrganizationId), ("$id", vehicle.Id));
        SqliteHelpers.Exec(connection, txn, """
            DELETE FROM vehicles WHERE id = $id AND organization_id = $org;
            """,
            ("$id", vehicle.Id), ("$org", _db.OrganizationId));

        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "vehicles", vehicle.Id, "hard_delete", req.OperatorId, operatorName,
            after: null, before: vehicle, reason: req.Reason);
        _db.InsertOutbox(connection, txn, "vehicles", vehicle.Id, "delete", vehicle,
            req.OperatorId, req.Reason);

        txn.Commit();
        return (true, null);
    }

    internal VehicleDto UpsertForTicket(SqliteConnection connection, SqliteTransaction txn,
        string plate, string normalized, CreateTicketRequest req, string operatorName)
    {
        var existing = FindVehicleByPlate(connection, txn, normalized);
        if (existing is null)
        {
            var id = Guid.NewGuid().ToString();
            var now = DateTimeOffset.Now.ToString("O");
            SqliteHelpers.Exec(connection, txn, """
                INSERT INTO vehicles (
                    id, organization_id, plate_number, plate_normalized,
                    default_driver_name, default_driver_phone, default_client,
                    default_material, registered_by, created_at, updated_at
                ) VALUES ($id, $org, $plate, $normalized, $driver, $phone, $client, $material, $by, $now, $now);
                """,
                ("$id", id), ("$org", _db.OrganizationId), ("$plate", plate),
                ("$normalized", normalized), ("$driver", req.Driver), ("$phone", req.Phone),
                ("$client", req.Client), ("$material", req.Material), ("$by", operatorName),
                ("$now", now));
            return ReadVehicle(connection, txn, id)!;
        }

        SqliteHelpers.Exec(connection, txn, """
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

    internal void ApplyCompletionStats(SqliteConnection connection, SqliteTransaction txn,
        string normalizedPlate, double tare, DateTimeOffset completedAt)
    {
        SqliteHelpers.Exec(connection, txn, """
            UPDATE vehicles SET
                trip_count = trip_count + 1,
                last_weighed_at = $at,
                last_tare_kg = $tare,
                row_version = row_version + 1,
                updated_at = $at
            WHERE organization_id = $org AND plate_normalized = $plate;
            """,
            ("$org", _db.OrganizationId), ("$plate", normalizedPlate),
            ("$tare", tare), ("$at", completedAt.ToString("O")));
    }

    internal void ApplyVoidStats(SqliteConnection connection, SqliteTransaction txn,
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
            cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
            cmd.Parameters.AddWithValue("$plate", normalizedPlate);
            using var reader = cmd.ExecuteReader();
            if (reader.Read())
            {
                lastTare = SqliteHelpers.Number(reader, "tare_weight_kg");
                lastAt = SqliteHelpers.Text(reader, "completed_at");
            }
        }

        SqliteHelpers.Exec(connection, txn, """
            UPDATE vehicles SET
                trip_count = CASE WHEN trip_count > 0 THEN trip_count - 1 ELSE 0 END,
                last_weighed_at = $at,
                last_tare_kg = $tare,
                row_version = row_version + 1,
                updated_at = $now
            WHERE organization_id = $org AND plate_normalized = $plate;
            """,
            ("$org", _db.OrganizationId), ("$plate", normalizedPlate),
            ("$at", (object?)lastAt ?? DBNull.Value),
            ("$tare", (object?)lastTare ?? DBNull.Value),
            ("$now", DateTimeOffset.Now.ToString("O")));
    }

    private VehicleDto? FindVehicleByPlate(SqliteConnection connection, SqliteTransaction txn,
        string normalizedPlate)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = "SELECT id FROM vehicles WHERE organization_id = $org AND plate_normalized = $plate;";
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
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
        var deletedAt = SqliteHelpers.ParseTimestamp(SqliteHelpers.Text(reader, "deleted_at"));
        return new VehicleDto
        {
            Id = SqliteHelpers.Text(reader, "id") ?? "",
            Plate = SqliteHelpers.Text(reader, "plate_number") ?? "",
            Driver = SqliteHelpers.Text(reader, "default_driver_name") ?? "",
            Phone = SqliteHelpers.Text(reader, "default_driver_phone") ?? "",
            Material = SqliteHelpers.Text(reader, "default_material") ?? "",
            Client = SqliteHelpers.Text(reader, "default_client") ?? "",
            Status = deletedAt is null ? "active" : "archived",
            TripCount = (int)(SqliteHelpers.Number(reader, "trip_count") ?? 0),
            LastTare = SqliteHelpers.Number(reader, "last_tare_kg"),
            LastWeighed = SqliteHelpers.ParseTimestamp(SqliteHelpers.Text(reader, "last_weighed_at")),
            ArchivedAt = deletedAt,
            ArchivedBy = SqliteHelpers.Text(reader, "deleted_by"),
            ArchivedReason = SqliteHelpers.Text(reader, "deleted_reason"),
            RegisteredBy = SqliteHelpers.Text(reader, "registered_by"),
            RegisteredAt = SqliteHelpers.ParseTimestamp(SqliteHelpers.Text(reader, "created_at")),
            Notes = SqliteHelpers.Text(reader, "notes"),
        };
    }
}
