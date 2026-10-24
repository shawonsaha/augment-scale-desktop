using AugmentScale.Data.Repositories;
using AugmentScale.Models;

namespace AugmentScale.Data.Services;

internal sealed class BootStateService : IBootStateService
{
    private const int BootHistoryLimit = 1000;

    private readonly DatabaseContext _db;
    private readonly OperatorRepository _operators;
    private readonly VehicleRepository _vehicles;
    private readonly TicketRepository _tickets;
    private readonly SyncStatusService _sync;

    public BootStateService(DatabaseContext db, OperatorRepository operators,
        VehicleRepository vehicles, TicketRepository tickets, SyncStatusService sync)
    {
        _db = db;
        _operators = operators;
        _vehicles = vehicles;
        _tickets = tickets;
        _sync = sync;
    }

    public BootStateDto GetBootState()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return new BootStateDto
        {
            Operators = _operators.GetOperators(connection),
            Vehicles = _vehicles.GetVehicles(connection),
            Pending = _tickets.GetPendingTickets(connection),
            History = _tickets.GetHistory(connection, BootHistoryLimit, null),
            NextTicketNumber = _tickets.PeekNextTicketNumber(connection, null),
            Sync = _sync.GetSyncStatus(connection),
        };
    }
}
