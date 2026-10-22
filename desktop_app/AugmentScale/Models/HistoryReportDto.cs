namespace AugmentScale.Models;

public sealed class HistoryReportDto
{
    public string ReportId { get; set; } = string.Empty;
    public string GeneratedAt { get; set; } = string.Empty;
    public string OrganizationName { get; set; } = string.Empty;
    public string SiteName { get; set; } = string.Empty;
    public string WeighbridgeName { get; set; } = string.Empty;
    public string WorkstationName { get; set; } = string.Empty;
    public string RangeLabel { get; set; } = string.Empty;
    public string FromDate { get; set; } = string.Empty;
    public string ToDate { get; set; } = string.Empty;
    public string OperatorId { get; set; } = string.Empty;
    public string OperatorName { get; set; } = string.Empty;
    public string IntegrityHash { get; set; } = string.Empty;
    public List<TicketDto> Tickets { get; set; } = [];
    public HistoryReportSummaryDto Summary { get; set; } = new();
}

public sealed class HistoryReportVerificationDto
{
    public string ReportId { get; set; } = string.Empty;
    public bool Matched { get; set; }
    public string ComputedHash { get; set; } = string.Empty;
    public string StoredHash { get; set; } = string.Empty;
    public string GeneratedAt { get; set; } = string.Empty;
    public string OperatorName { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

public sealed class HistoryReportSummaryDto
{
    public int Total { get; set; }
    public int Completed { get; set; }
    public int Pending { get; set; }
    public int Voided { get; set; }
    public int Deleted { get; set; }
    public int Overrides { get; set; }
    public int Reprints { get; set; }
    public double NetKg { get; set; }
}
