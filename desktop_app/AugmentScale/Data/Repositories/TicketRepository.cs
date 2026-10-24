using System.Globalization;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data.Repositories;

internal sealed class TicketRepository : ITicketRepository
{
    private const long FirstTicketNumber = 11353;
    private const long LastHistoricalTicketNumber = 11352;
    private const int DefaultHistoryLimit = 1000;

    private readonly DatabaseContext _db;
    private readonly VehicleRepository _vehicles;

    public TicketRepository(DatabaseContext db, VehicleRepository vehicles)
    {
        _db = db;
        _vehicles = vehicles;
    }

    public long PeekNextTicketNumber()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return PeekNextTicketNumber(connection, null);
    }

    internal long PeekNextTicketNumber(SqliteConnection connection, SqliteTransaction? txn)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT COALESCE(MAX(ticket_number), $fallback) + 1
            FROM weigh_tickets WHERE organization_id = $org;
            """;
        cmd.Parameters.AddWithValue("$fallback", LastHistoricalTicketNumber);
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        return Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    public IReadOnlyList<TicketDto> GetPendingTickets()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetPendingTickets(connection);
    }

    internal IReadOnlyList<TicketDto> GetPendingTickets(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT * FROM ticket_history
            WHERE organization_id = $org AND status = 'pending' AND deleted_at IS NULL
            ORDER BY created_at DESC;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        var tickets = ReadTickets(connection, null, cmd);
        foreach (var ticket in tickets) FillPreviousTripStats(connection, null, ticket);
        return tickets;
    }

    public IReadOnlyList<TicketDto> GetHistory(int? limit = null, string? status = null)
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetHistory(connection, limit, status);
    }

    internal IReadOnlyList<TicketDto> GetHistory(SqliteConnection connection, int? limit, string? status)
    {
        // Unbounded history pulls would slow startup as tickets accumulate; the
        // UI pages and filters in memory, so cap the default window and let
        // callers (date-range views) opt into explicit limits.
        var effectiveLimit = limit is > 0 ? limit.Value : DefaultHistoryLimit;
        using var cmd = connection.CreateCommand();
        var filter = string.IsNullOrWhiteSpace(status)
            ? string.Empty
            : " AND status_display = $status";
        cmd.CommandText = $"""
            SELECT * FROM ticket_history
            WHERE organization_id = $org{filter}
            ORDER BY business_at DESC
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        if (!string.IsNullOrWhiteSpace(status)) cmd.Parameters.AddWithValue("$status", status);
        cmd.Parameters.AddWithValue("$limit", effectiveLimit);
        return ReadTickets(connection, null, cmd);
    }

    public IReadOnlyList<TicketDto> GetHistoryRange(string fromDate, string toDate)
    {
        _db.EnsureInitialized();
        if (!DateOnly.TryParseExact(fromDate, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var fromDay))
            throw new InvalidOperationException("Choose a valid history start date.");
        if (!DateOnly.TryParseExact(toDate, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var toDay))
            throw new InvalidOperationException("Choose a valid history end date.");
        if (fromDay > toDay)
            throw new InvalidOperationException("The history start date must be before the end date.");

        var fromUtc = fromDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Local)
            .ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        var toUtc = toDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Local).AddDays(1)
            .ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

        using var connection = _db.OpenConnection();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT * FROM ticket_history
            WHERE organization_id = $org
              AND datetime(business_at) >= datetime($from)
              AND datetime(business_at) < datetime($to)
            ORDER BY business_at DESC
            LIMIT 5000;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$from", fromUtc);
        cmd.Parameters.AddWithValue("$to", toUtc);
        return ReadTickets(connection, null, cmd);
    }

    public TicketDto? GetTicket(long ticketNumber)
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetTicket(connection, null, ticketNumber);
    }

    internal TicketDto? GetTicket(SqliteConnection connection, SqliteTransaction? txn, long number)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT * FROM ticket_history
            WHERE organization_id = $org AND ticket_number = $number;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$number", number);
        var list = ReadTickets(connection, txn, cmd);
        return list.Count == 0 ? null : list[0];
    }

    public TicketDto CreateTicket(CreateTicketRequest req)
    {
        _db.EnsureInitialized();
        var plate = req.TruckNo.Trim();
        var normalized = SqliteHelpers.NormalizePlate(plate);
        if (plate.Length == 0) throw new InvalidOperationException("Truck number is required.");
        if (req.WeightKg < 0) throw new InvalidOperationException("Weight cannot be negative.");

        var direction = string.Equals(req.Direction, "OUT", StringComparison.OrdinalIgnoreCase) ? "OUT" : "IN";
        var firstType = string.Equals(req.FirstWeightType, "Tare", StringComparison.OrdinalIgnoreCase)
            ? "tare"
            : "gross";
        if (direction == "OUT") firstType = "tare";
        else firstType = "gross";

        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();

        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var existingOpen = FindOpenTicketNumber(connection, txn, normalized, null);
        if (existingOpen is not null)
            throw new InvalidOperationException($"Truck {plate} already has open ticket #{existingOpen.Value}.");

        var createdAt = SqliteHelpers.ParseTimestamp(req.FirstTime) ?? DateTimeOffset.Now;
        var ticketId = Guid.NewGuid().ToString();
        var ticketNumber = PeekNextTicketNumber(connection, txn);
        var vehicle = _vehicles.UpsertForTicket(connection, txn, plate, normalized, req, operatorName);

        SqliteHelpers.Exec(connection, txn, """
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
            ("$id", ticketId), ("$org", _db.OrganizationId), ("$site", _db.SiteId),
            ("$wb", _db.WeighbridgeId), ("$ws", _db.WorkstationId),
            ("$number", ticketNumber), ("$display", ticketNumber.ToString(CultureInfo.InvariantCulture)),
            ("$direction", direction), ("$vehicle", vehicle.Id), ("$plate", plate),
            ("$product", req.Material), ("$customer", req.Client), ("$driver", req.Driver),
            ("$phone", req.Phone), ("$challan", req.Challan), ("$remarks", req.Remarks),
            ("$weight", req.WeightKg), ("$weightType", firstType),
            ("$weightAt", createdAt.ToString("O")),
            ("$opId", SqliteHelpers.OperatorId(req.OperatorId)), ("$opName", operatorName),
            ("$createdAt", createdAt.ToString("O")));

        var captureId = InsertCapture(connection, txn, ticketId, 1, false, req.WeightKg,
            req.Reading, req.OperatorId, createdAt, firstType);
        SqliteHelpers.Exec(connection, txn,
            "UPDATE weigh_tickets SET first_weight_capture_id = $capture WHERE id = $id;",
            ("$capture", captureId), ("$id", ticketId));

        if (req.RecordFirstPrint)
        {
            InsertPrintJob(connection, txn, ticketId, "first_weigh_slip", 1, false, null,
                req.OperatorId, createdAt);
        }

        var ticket = GetTicket(connection, txn, ticketNumber)
            ?? throw new InvalidOperationException("Ticket could not be read after creation.");

        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "weigh_tickets", ticketId, "insert", req.OperatorId, operatorName, ticket);
        _db.InsertOutbox(connection, txn, "weigh_tickets", ticketId, "insert", ticket, req.OperatorId);

        txn.Commit();
        return ticket;
    }

    public TicketDto CompleteTicket(CompleteTicketRequest req)
    {
        _db.EnsureInitialized();
        if (req.WeightKg < 0) throw new InvalidOperationException("Weight cannot be negative.");

        using var connection = _db.OpenConnection();
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
        find.Parameters.AddWithValue("$org", _db.OrganizationId);

        string ticketUuid;
        double firstWeight;
        string firstType;
        string plateNormalized;
        using (var reader = find.ExecuteReader())
        {
            if (!reader.Read()) throw new InvalidOperationException($"Ticket #{req.TicketId} was not found.");
            ticketUuid = SqliteHelpers.Text(reader, "id")!;
            firstWeight = SqliteHelpers.Number(reader, "first_weight_kg") ?? 0;
            firstType = SqliteHelpers.Text(reader, "first_weight_type") ?? "gross";
            var status = SqliteHelpers.Text(reader, "status");
            var deleted = SqliteHelpers.Text(reader, "deleted_at");
            plateNormalized = SqliteHelpers.Text(reader, "plate_normalized") ?? "";
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
        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        var captureId = InsertCapture(connection, txn, ticketUuid, 2, true, req.WeightKg,
            req.Reading, req.OperatorId, completedAt, secondType);

        var overrideJson = req.Override is null ? null : SqliteHelpers.SerializeJsonElement(req.Override.AnomalyDetails);
        var overrideAt = SqliteHelpers.ParseTimestamp(req.Override?.Timestamp) ?? completedAt;

        SqliteHelpers.Exec(connection, txn, """
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
            ("$opId", SqliteHelpers.OperatorId(req.OperatorId)), ("$opName", operatorName),
            ("$gross", gross), ("$tare", tare), ("$net", net),
            ("$overridden", req.Override is null ? 0 : 1),
            ("$overrideReason", (object?)req.Override?.Reason ?? DBNull.Value),
            ("$overrideOpId", req.Override is null ? DBNull.Value : (object)SqliteHelpers.OperatorId(req.OperatorId)),
            ("$overrideOpName", (object?)req.Override?.Operator ?? DBNull.Value),
            ("$overrideDetails", (object?)overrideJson ?? DBNull.Value),
            ("$overrideAt", req.Override is null ? DBNull.Value : overrideAt.ToString("O")),
            ("$completedAt", completedAt.ToString("O")));

        if (req.RecordCertificatePrint)
        {
            InsertPrintJob(connection, txn, ticketUuid, "weighbridge_certificate", 1, false, null,
                req.OperatorId, completedAt);
        }

        _vehicles.ApplyCompletionStats(connection, txn, plateNormalized, tare, completedAt);

        var ticket = GetTicket(connection, txn, req.TicketId)
            ?? throw new InvalidOperationException("Ticket could not be read after completion.");

        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "weigh_tickets", ticketUuid, "complete", req.OperatorId, operatorName, ticket,
            reason: req.Override?.Reason);
        _db.InsertOutbox(connection, txn, "weigh_tickets", ticketUuid, "update", ticket,
            req.OperatorId, req.Override?.Reason);

        txn.Commit();
        return ticket;
    }

    public TicketDto VoidTicket(TicketReasonRequest req)
    {
        _db.EnsureInitialized();
        if (string.IsNullOrWhiteSpace(req.Reason))
            throw new InvalidOperationException("A void reason is required.");

        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();

        var ticket = GetTicketByNumber(connection, txn, req.TicketId);
        if (ticket is null) throw new InvalidOperationException($"Ticket #{req.TicketId} was not found.");
        if (ticket.Status != "completed")
            throw new InvalidOperationException("Only completed tickets can be voided.");

        var now = DateTimeOffset.Now;
        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);

        SqliteHelpers.Exec(connection, txn, """
            UPDATE weigh_tickets SET
                status = 'voided', voided_at = $now, voided_by = $by, voided_reason = $reason,
                updated_at = $now, updated_by = $opId, row_version = row_version + 1
            WHERE id = $id AND status = 'completed';
            """,
            ("$id", ticket.Uuid), ("$now", now.ToString("O")), ("$by", operatorName),
            ("$reason", req.Reason), ("$opId", SqliteHelpers.OperatorId(req.OperatorId)));

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
            correction.Parameters.AddWithValue("$org", _db.OrganizationId);
            correction.Parameters.AddWithValue("$reason", req.Reason);
            correction.Parameters.AddWithValue("$by", SqliteHelpers.OperatorId(req.OperatorId));
            correction.Parameters.AddWithValue("$now", now.ToString("O"));
            correction.ExecuteNonQuery();
        }

        _vehicles.ApplyVoidStats(connection, txn, ticket.PlateNormalized);

        var updated = GetTicket(connection, txn, req.TicketId)!;
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "weigh_tickets", ticket.Uuid, "void", req.OperatorId, operatorName, updated,
            before: ticket.Dto, reason: req.Reason);
        _db.InsertOutbox(connection, txn, "weigh_tickets", ticket.Uuid, "update", updated,
            req.OperatorId, req.Reason);

        txn.Commit();
        return updated;
    }

    public TicketDto SoftDeleteTicket(TicketReasonRequest req)
    {
        _db.EnsureInitialized();
        if (string.IsNullOrWhiteSpace(req.Reason))
            throw new InvalidOperationException("A delete reason is required.");

        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();

        var ticket = GetTicketByNumber(connection, txn, req.TicketId);
        if (ticket is null) throw new InvalidOperationException($"Ticket #{req.TicketId} was not found.");
        if (ticket.Status != "pending")
            throw new InvalidOperationException("Only pending tickets can be deleted.");

        var now = DateTimeOffset.Now;
        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        SqliteHelpers.Exec(connection, txn, """
            UPDATE weigh_tickets SET
                deleted_at = $now, deleted_by = $by, deleted_reason = $reason,
                updated_at = $now, updated_by = $opId, row_version = row_version + 1
            WHERE id = $id AND status = 'pending' AND deleted_at IS NULL;
            """,
            ("$id", ticket.Uuid), ("$now", now.ToString("O")), ("$by", operatorName),
            ("$reason", req.Reason), ("$opId", SqliteHelpers.OperatorId(req.OperatorId)));

        var updated = GetTicket(connection, txn, req.TicketId)!;
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "weigh_tickets", ticket.Uuid, "soft_delete", req.OperatorId, operatorName, updated,
            before: ticket.Dto, reason: req.Reason);
        _db.InsertOutbox(connection, txn, "weigh_tickets", ticket.Uuid, "delete", updated,
            req.OperatorId, req.Reason);

        txn.Commit();
        return updated;
    }

    public (TicketDto Ticket, int CopyNumber) RecordReprint(ReprintRequest req)
    {
        _db.EnsureInitialized();
        if (string.IsNullOrWhiteSpace(req.Reason))
            throw new InvalidOperationException("A reprint reason is required.");

        using var connection = _db.OpenConnection();
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

        var operatorName = OperatorRepository.ResolveOperatorName(connection, txn, req.OperatorId, req.OperatorName);
        InsertPrintJob(connection, txn, ticket.Uuid, documentType, nextCopy, true, req.Reason,
            req.OperatorId, DateTimeOffset.Now);

        var updated = GetTicket(connection, txn, req.TicketId)!;
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "print_jobs", $"{ticket.Uuid}:{documentType}:{nextCopy}", "reprint",
            req.OperatorId, operatorName,
            new { ticketId = req.TicketId, documentType, copyNumber = nextCopy, reason = req.Reason },
            reason: req.Reason);
        _db.InsertOutbox(connection, txn, "weigh_tickets", ticket.Uuid, "update", updated,
            req.OperatorId, req.Reason);

        txn.Commit();
        return (updated, nextCopy);
    }

    internal IReadOnlyList<TicketDto> ReadTicketsForReport(SqliteConnection connection,
        SqliteTransaction txn, string fromUtc, string toUtc)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT * FROM ticket_history
            WHERE organization_id = $org
              AND datetime(business_at) >= datetime($from)
              AND datetime(business_at) < datetime($to)
            ORDER BY datetime(business_at), ticket_number;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$from", fromUtc);
        cmd.Parameters.AddWithValue("$to", toUtc);
        return ReadTickets(connection, txn, cmd);
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
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$plate", normalizedPlate);
        cmd.Parameters.AddWithValue("$exclude", (object?)excludeTicketId ?? DBNull.Value);
        var result = cmd.ExecuteScalar();
        return result is null ? null : Convert.ToInt64(result, CultureInfo.InvariantCulture);
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

        SqliteHelpers.Exec(connection, txn, """
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
            ("$id", id), ("$ticket", ticketUuid), ("$org", _db.OrganizationId),
            ("$seq", sequence), ("$final", isFinal ? 1 : 0),
            ("$weight", weight), ("$digits", rawDigits), ("$sign", sign),
            ("$decimals", decimalCount), ("$hex", rawHex), ("$checksum", checksumValid ? 1 : 0),
            ("$expected", (object?)reading?.ChecksumExpected ?? DBNull.Value),
            ("$actual", (object?)reading?.ChecksumActual ?? DBNull.Value),
            ("$stable", reading?.IsStable == true ? 1 : 0),
            ("$variance", (object?)reading?.StabilityVariance ?? DBNull.Value),
            ("$window", (object?)reading?.StabilityWindowMs ?? DBNull.Value),
            ("$samples", (object?)reading?.StabilitySampleCount ?? DBNull.Value),
            ("$profile", _db.ScaleProfileId), ("$source", source), ("$ws", _db.WorkstationId),
            ("$op", SqliteHelpers.OperatorId(operatorId)), ("$at", capturedAt.ToString("O")));
        return id;
    }

    private string InsertPrintJob(SqliteConnection connection, SqliteTransaction txn,
        string ticketUuid, string documentType, int copyNumber, bool isReprint,
        string? reason, string operatorId, DateTimeOffset printedAt)
    {
        var id = Guid.NewGuid().ToString();
        SqliteHelpers.Exec(connection, txn, """
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
            ("$id", id), ("$ticket", ticketUuid), ("$org", _db.OrganizationId),
            ("$type", documentType), ("$reprint", isReprint ? 1 : 0), ("$copy", copyNumber),
            ("$reason", (object?)reason ?? DBNull.Value), ("$by", SqliteHelpers.OperatorId(operatorId)),
            ("$at", printedAt.ToString("O")), ("$ws", _db.WorkstationId));
        return id;
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
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return null;
        return new TicketRecord(SqliteHelpers.Text(reader, "id")!,
            SqliteHelpers.Text(reader, "plate_normalized") ?? "", dto);
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

        // One IN (...) query for all tickets instead of a per-ticket print-log
        // round-trip (N+1) — startup loads hundreds of rows at once.
        if (results.Count > 0)
        {
            var printLogs = ReadPrintLogs(connection, txn, results.Select(dto => dto.TicketUuid!));
            if (printLogs.Count > 0)
            {
                foreach (var dto in results)
                {
                    if (printLogs.TryGetValue(dto.TicketUuid!, out var log)) dto.PrintLog = log;
                }
            }
        }
        return results;
    }

    private Dictionary<string, List<PrintLogEntryDto>> ReadPrintLogs(SqliteConnection connection,
        SqliteTransaction? txn, IEnumerable<string> ticketUuids)
    {
        var uuids = ticketUuids.Where(u => !string.IsNullOrEmpty(u)).Distinct().ToList();
        if (uuids.Count == 0) return new Dictionary<string, List<PrintLogEntryDto>>();

        var inClause = string.Join(", ", uuids.Select((uuid, index) => $"$ticket{index}"));

        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = $"""
            SELECT p.ticket_id, p.document_type, p.is_reprint, p.copy_number, p.reprint_reason,
                   p.printed_at, COALESCE(pr.display_name, p.printed_by) AS printed_by
            FROM print_jobs p
            LEFT JOIN profiles pr ON pr.id = p.printed_by
            WHERE p.ticket_id IN ({inClause})
            ORDER BY p.ticket_id, p.printed_at, p.copy_number;
            """;
        for (var i = 0; i < uuids.Count; i++)
        {
            cmd.Parameters.AddWithValue($"$ticket{i}", uuids[i]);
        }

        var list = new Dictionary<string, List<PrintLogEntryDto>>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var ticketUuid = SqliteHelpers.Text(reader, "ticket_id") ?? string.Empty;
            if (!list.TryGetValue(ticketUuid, out var entries))
            {
                entries = new List<PrintLogEntryDto>();
                list[ticketUuid] = entries;
            }

            var reprint = SqliteHelpers.Number(reader, "is_reprint") == 1;
            entries.Add(new PrintLogEntryDto
            {
                By = SqliteHelpers.Text(reader, "printed_by") ?? "Unknown",
                At = SqliteHelpers.Text(reader, "printed_at") ?? "",
                Type = reprint ? "reprint" : SqliteHelpers.Text(reader, "document_type") ?? "first_weigh_slip",
                Reason = SqliteHelpers.Text(reader, "reprint_reason"),
                CopyNumber = (int?)SqliteHelpers.Number(reader, "copy_number"),
            });
        }
        return list;
    }

    private List<PrintLogEntryDto> ReadPrintLog(SqliteConnection connection, SqliteTransaction? txn,
        string ticketUuid)
    {
        var batched = ReadPrintLogs(connection, txn, new[] { ticketUuid });
        return batched.TryGetValue(ticketUuid, out var entries) ? entries : new List<PrintLogEntryDto>();
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
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$plate", SqliteHelpers.NormalizePlate(ticket.TruckNo));
        cmd.Parameters.AddWithValue("$number", ticket.Id);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return;
        ticket.LastGross = SqliteHelpers.Number(reader, "gross_weight_kg");
        ticket.LastTare = SqliteHelpers.Number(reader, "tare_weight_kg");
        ticket.LastPayload = SqliteHelpers.Number(reader, "net_weight_kg");
        var at = SqliteHelpers.ParseTimestamp(SqliteHelpers.Text(reader, "completed_at"));
        ticket.LastWeighAt = at?.ToString("dd MMM", CultureInfo.InvariantCulture);
    }

    private static TicketDto MapTicket(SqliteDataReader reader)
    {
        var direction = SqliteHelpers.Text(reader, "direction") ?? "IN";
        var createdAt = SqliteHelpers.ParseTimestamp(SqliteHelpers.Text(reader, "created_at"));
        var firstWeight = SqliteHelpers.Number(reader, "first_weight_kg");
        var firstType = SqliteHelpers.Text(reader, "first_weight_type");
        var statusDisplay = SqliteHelpers.Text(reader, "status_display")
                            ?? SqliteHelpers.Text(reader, "status") ?? "pending";
        var overrideDetails = SqliteHelpers.Text(reader, "override_anomaly_details");
        var overridden = SqliteHelpers.Number(reader, "is_overridden") == 1;

        return new TicketDto
        {
            TicketUuid = SqliteHelpers.Text(reader, "id"),
            Id = Convert.ToInt64(SqliteHelpers.Number(reader, "ticket_number") ?? 0),
            TicketDisplayId = SqliteHelpers.Text(reader, "ticket_display_id") ?? "",
            TruckNo = SqliteHelpers.Text(reader, "plate_number") ?? "",
            Driver = SqliteHelpers.Text(reader, "driver_name") ?? "",
            Phone = SqliteHelpers.Text(reader, "driver_phone") ?? "",
            Material = SqliteHelpers.Text(reader, "product_name") ?? "",
            Client = SqliteHelpers.Text(reader, "customer_name") ?? "",
            Challan = SqliteHelpers.Text(reader, "challan") ?? "",
            Remarks = SqliteHelpers.Text(reader, "remarks") ?? "",
            Direction = direction,
            WeightType = direction == "OUT" ? "OUT WEIGHT" : "IN WEIGHT",
            Status = statusDisplay,
            Deleted = statusDisplay == "deleted",
            BusinessAt = SqliteHelpers.Text(reader, "business_at"),
            FirstWeight = firstWeight,
            FirstWeightType = SqliteHelpers.TitleCase(firstType),
            FirstWeightTime = SqliteHelpers.FormatTimestamp(createdAt),
            FirstOperator = SqliteHelpers.Text(reader, "first_operator_name"),
            SecondWeight = SqliteHelpers.Number(reader, "second_weight_kg"),
            SecondWeightType = SqliteHelpers.TitleCase(SqliteHelpers.Text(reader, "second_weight_type")),
            SecondWeightTime = SqliteHelpers.FormatTimestamp(
                SqliteHelpers.ParseTimestamp(SqliteHelpers.Text(reader, "second_weight_at"))),
            SecondOperator = SqliteHelpers.Text(reader, "second_operator_name"),
            GrossWeight = SqliteHelpers.Number(reader, "gross_weight_kg"),
            TareWeight = SqliteHelpers.Number(reader, "tare_weight_kg"),
            NetWeight = SqliteHelpers.Number(reader, "net_weight_kg"),
            CreatedAt = createdAt?.ToString("O"),
            CompletedAt = SqliteHelpers.Text(reader, "completed_at"),
            SecondCompletedAt = SqliteHelpers.ParseTimestamp(SqliteHelpers.Text(reader, "completed_at")),
            VoidedAt = SqliteHelpers.Text(reader, "voided_at"),
            VoidedBy = SqliteHelpers.Text(reader, "voided_by"),
            VoidedReason = SqliteHelpers.Text(reader, "voided_reason"),
            DeletedAt = SqliteHelpers.Text(reader, "deleted_at"),
            DeletedBy = SqliteHelpers.Text(reader, "deleted_by"),
            DeletedReason = SqliteHelpers.Text(reader, "deleted_reason"),
            TimeElapsed = SqliteHelpers.FormatElapsed(createdAt),
            Override = overridden
                ? new TicketOverrideDto
                {
                    Reason = SqliteHelpers.Text(reader, "override_reason") ?? "",
                    Operator = SqliteHelpers.Text(reader, "override_operator_name") ?? "",
                    Timestamp = SqliteHelpers.FormatTimestamp(
                        SqliteHelpers.ParseTimestamp(SqliteHelpers.Text(reader, "override_at"))),
                    AnomalyDetails = overrideDetails,
                }
                : null,
            PrintCount = (int)(SqliteHelpers.Number(reader, "print_count") ?? 0),
            FirstOperatorAvatar = SqliteHelpers.Text(reader, "first_operator_avatar"),
            SecondOperatorAvatar = SqliteHelpers.Text(reader, "second_operator_avatar"),
        };
    }

    private sealed record TicketRecord(string Uuid, string PlateNormalized, TicketDto Dto)
    {
        public string Status => Dto.Status;
    }
}
