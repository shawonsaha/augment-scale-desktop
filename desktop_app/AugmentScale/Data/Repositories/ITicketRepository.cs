using AugmentScale.Models;
using AugmentScale.Models.Commands;

namespace AugmentScale.Data.Repositories;

public interface ITicketRepository
{
    long PeekNextTicketNumber();
    IReadOnlyList<TicketDto> GetPendingTickets();
    IReadOnlyList<TicketDto> GetHistory(int? limit = null, string? status = null);
    HistoryPageDto HistoryPage(HistoryPageRequest req);
    TicketDto? GetTicket(long ticketNumber);
    TicketDto CreateTicket(CreateTicketRequest req);
    TicketDto CompleteTicket(CompleteTicketRequest req);
    TicketDto VoidTicket(TicketReasonRequest req);
    TicketDto SoftDeleteTicket(TicketReasonRequest req);
    (TicketDto Ticket, int CopyNumber) RecordReprint(ReprintRequest req);
}
