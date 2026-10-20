using AugmentScale.Models.Commands;

namespace AugmentScale.Services;

/// <summary>
/// Printing itself stays in the WebView (window.print -> system print dialog).
/// This service records every print and reprint for the audit trail.
/// </summary>
public sealed class PrintService
{
    private readonly DatabaseService _database;

    public PrintService(DatabaseService database)
    {
        _database = database;
    }

    public (Models.TicketDto Ticket, int CopyNumber) RecordReprint(ReprintRequest request) =>
        _database.RecordReprint(request);

    public PrintJobRecord RecordPrint(long ticketNumber, string? documentType, string operatorId,
        string operatorName, string? reason = null) =>
        _database.RecordPrintJob(ticketNumber, documentType, operatorId, operatorName, reason);
}
