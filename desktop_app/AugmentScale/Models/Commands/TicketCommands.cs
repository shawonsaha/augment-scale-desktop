using System.Text.Json;

namespace AugmentScale.Models.Commands;

public sealed class CreateTicketRequest
{
    public long? TicketId { get; set; }
    public string TruckNo { get; set; } = string.Empty;
    public string Direction { get; set; } = "IN";
    public string Driver { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Material { get; set; } = "Other";
    public string Client { get; set; } = string.Empty;
    public string Challan { get; set; } = string.Empty;
    public string Remarks { get; set; } = string.Empty;
    public double WeightKg { get; set; }
    public string FirstWeightType { get; set; } = "Gross";
    public string FirstTime { get; set; } = string.Empty;
    public string OperatorId { get; set; } = string.Empty;
    public string OperatorName { get; set; } = string.Empty;
    public bool RecordFirstPrint { get; set; } = true;
    public WeightReading? Reading { get; set; }
}

public sealed class CompleteTicketRequest
{
    public long TicketId { get; set; }
    public double WeightKg { get; set; }
    public string SecondTime { get; set; } = string.Empty;
    public string OperatorId { get; set; } = string.Empty;
    public string OperatorName { get; set; } = string.Empty;
    public OverrideRequest? Override { get; set; }
    public bool RecordCertificatePrint { get; set; } = true;
    public WeightReading? Reading { get; set; }
}

public sealed class OverrideRequest
{
    public string Reason { get; set; } = string.Empty;
    public string Operator { get; set; } = string.Empty;
    public string Timestamp { get; set; } = string.Empty;
    public JsonElement? AnomalyDetails { get; set; }
}

public sealed class TicketReasonRequest
{
    public long TicketId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string OperatorId { get; set; } = string.Empty;
    public string OperatorName { get; set; } = string.Empty;
}

public sealed class ReprintRequest
{
    public long TicketId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string OperatorId { get; set; } = string.Empty;
    public string OperatorName { get; set; } = string.Empty;
    public string? DocumentType { get; set; }
}

public sealed class HistoryQueryRequest
{
    public int? Limit { get; set; }
    public int? Offset { get; set; }
    public string? Status { get; set; }
}
