using AugmentScale.Data;
using AugmentScale.Data.Repositories;
using AugmentScale.Data.Services;
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
    private readonly DatabaseContext _context;
    private readonly OperatorRepository _operators;
    private readonly VehicleRepository _vehicles;
    private readonly TicketRepository _tickets;
    private readonly HistoryReportService _reports;
    private readonly ArchiveRunRepository _archives;
    private readonly SyncStatusService _sync;
    private readonly ScaleHealthService _health;
    private readonly BootStateService _boot;

    public DatabaseService(ConfigService config, AuditService? audit = null)
    {
        _context = new DatabaseContext(config, audit);
        _operators = new OperatorRepository(_context);
        _vehicles = new VehicleRepository(_context);
        _tickets = new TicketRepository(_context, _vehicles);
        _reports = new HistoryReportService(_context, _operators, _tickets);
        _archives = new ArchiveRunRepository(_context);
        _sync = new SyncStatusService(_context, _archives);
        _health = new ScaleHealthService(_context);
        _boot = new BootStateService(_context, _operators, _vehicles, _tickets, _sync);

        Operators = _operators;
        Vehicles = _vehicles;
        Tickets = _tickets;
        Reports = _reports;
        Sync = _sync;
        Health = _health;
        Boot = _boot;
    }

    public IOperatorRepository Operators { get; }
    public IVehicleRepository Vehicles { get; }
    public ITicketRepository Tickets { get; }
    public IReportService Reports { get; }
    public ISyncStatusService Sync { get; }
    public IScaleHealthService Health { get; }
    public IBootStateService Boot { get; }
    internal ArchiveRunRepository ArchiveRuns => _archives;

    public string OrganizationId { get { EnsureInitialized(); return _context.OrganizationId; } }
    public string SiteId { get { EnsureInitialized(); return _context.SiteId; } }
    public string WeighbridgeId { get { EnsureInitialized(); return _context.WeighbridgeId; } }
    public string WorkstationId { get { EnsureInitialized(); return _context.WorkstationId; } }
    public string ScaleProfileId { get { EnsureInitialized(); return _context.ScaleProfileId; } }
    public string DatabasePath => _context.DatabasePath;

    public void EnsureInitialized() => _context.EnsureInitialized();

    public SqliteConnection OpenConnection() => _context.OpenConnection();

    public IReadOnlyList<ProfileDto> GetOperators() => _operators.GetOperators();

    public ProfileDto? AuthenticateOperator(string profileId, string pin) =>
        _operators.AuthenticateOperator(profileId, pin);

    public ProfileDto? AuthenticateSupervisor(string profileId, string pin) =>
        _operators.AuthenticateSupervisor(profileId, pin);

    public ProfileDto CreateProfile(ProfileWriteRequest request, string actorId, string actorName) =>
        _operators.CreateProfile(request, actorId, actorName);

    public ProfileDto UpdateProfile(ProfileWriteRequest request, string actorId, string actorName) =>
        _operators.UpdateProfile(request, actorId, actorName);

    public bool SetProfilePin(SetProfilePinRequest request, string actorId, string actorName) =>
        _operators.SetProfilePin(request, actorId, actorName);

    public bool DeactivateProfile(DeactivateProfileRequest request, string actorId, string actorName) =>
        _operators.DeactivateProfile(request, actorId, actorName);

    public IReadOnlyList<VehicleDto> GetVehicles() => _vehicles.GetVehicles();

    public IReadOnlyList<VehicleDto> GetActiveVehicles() => _vehicles.GetActiveVehicles();

    public VehicleDto RegisterVehicle(VehicleRequest req) => _vehicles.RegisterVehicle(req);

    public (bool Ok, string? Error, VehicleDto? Vehicle) ArchiveVehicle(ArchiveVehicleRequest req) =>
        _vehicles.ArchiveVehicle(req);

    public VehicleDto? RestoreVehicle(ArchiveVehicleRequest req) => _vehicles.RestoreVehicle(req);

    public (bool Ok, string? Error) DeleteVehicle(DeleteVehicleRequest req) =>
        _vehicles.DeleteVehicle(req);

    public long PeekNextTicketNumber() => _tickets.PeekNextTicketNumber();

    public IReadOnlyList<TicketDto> GetPendingTickets() => _tickets.GetPendingTickets();

    public IReadOnlyList<TicketDto> GetHistory(int? limit = null, string? status = null) =>
        _tickets.GetHistory(limit, status);

    /// <summary>
    /// Fast boot snapshot: one connection, one round-trip for everything the
    /// workstation shell shows right after launch.
    /// </summary>
    public BootStateDto GetBootState() => _boot.GetBootState();

    /// <summary>
    /// One filtered, sorted page of the History ledger. Only the visible page
    /// crosses the bridge; totals and filter options are computed in SQLite.
    /// </summary>
    public HistoryPageDto HistoryPage(HistoryPageRequest req) => _tickets.HistoryPage(req);

    public TicketDto? GetTicket(long ticketNumber) => _tickets.GetTicket(ticketNumber);

    public HistoryReportDto GenerateHistoryReport(HistoryReportRequest req) =>
        _reports.GenerateHistoryReport(req);

    public HistoryReportVerificationDto VerifyHistoryReport(VerifyHistoryReportRequest req) =>
        _reports.VerifyHistoryReport(req);

    public TicketDto CreateTicket(CreateTicketRequest req) => _tickets.CreateTicket(req);

    public TicketDto CompleteTicket(CompleteTicketRequest req) => _tickets.CompleteTicket(req);

    public TicketDto VoidTicket(TicketReasonRequest req) => _tickets.VoidTicket(req);

    public TicketDto SoftDeleteTicket(TicketReasonRequest req) => _tickets.SoftDeleteTicket(req);

    public (TicketDto Ticket, int CopyNumber) RecordReprint(ReprintRequest req) =>
        _tickets.RecordReprint(req);

    public SyncStatusDto GetSyncStatus() => _sync.GetSyncStatus();

    public void RecordScaleHealth(string eventType, string details, DateTimeOffset? at = null) =>
        _health.RecordScaleHealth(eventType, details, at);

    public static string NormalizePlate(string plate) => SqliteHelpers.NormalizePlate(plate);

    public static string FormatTimestamp(DateTimeOffset? value) => SqliteHelpers.FormatTimestamp(value);
}
