using System.Text.Json.Serialization;

namespace AugmentScale.Models;

/// <summary>
/// Flattened ticket shape consumed directly by the prototype dashboard,
/// history, second-weigh and print modules.
/// </summary>
public sealed class TicketDto
{
    [JsonIgnore]
    public string? TicketUuid { get; set; }

    public long Id { get; set; }
    public string TicketDisplayId { get; set; } = string.Empty;
    public string TruckNo { get; set; } = string.Empty;
    public string Driver { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Material { get; set; } = string.Empty;
    public string Client { get; set; } = string.Empty;
    public string Challan { get; set; } = string.Empty;
    public string Remarks { get; set; } = string.Empty;
    public string Direction { get; set; } = "IN";
    public string WeightType { get; set; } = "IN WEIGHT";
    public string Status { get; set; } = "pending";
    public bool Deleted { get; set; }
    public string? BusinessAt { get; set; }

    public double? FirstWeight { get; set; }
    public string? FirstWeightType { get; set; }
    public string? FirstWeightTime { get; set; }
    public string? FirstOperator { get; set; }
    public string? FirstOperatorAvatar { get; set; }

    public double? SecondWeight { get; set; }
    public string? SecondWeightType { get; set; }
    public string? SecondWeightTime { get; set; }
    public string? SecondOperator { get; set; }
    public string? SecondOperatorAvatar { get; set; }

    public double? GrossWeight { get; set; }
    public double? TareWeight { get; set; }
    public double? NetWeight { get; set; }

    public double? LastTare { get; set; }
    public double? LastGross { get; set; }
    public double? LastPayload { get; set; }
    public string? LastWeighAt { get; set; }

    public string? TimeElapsed { get; set; }
    public string? CreatedAt { get; set; }
    public string? CompletedAt { get; set; }
    public DateTimeOffset? SecondCompletedAt { get; set; }
    public string? VoidedAt { get; set; }
    public string? VoidedBy { get; set; }
    public string? VoidedReason { get; set; }
    public string? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }
    public string? DeletedReason { get; set; }

    public int PrintCount { get; set; } = 1;
    public List<PrintLogEntryDto> PrintLog { get; set; } = [];
    public TicketOverrideDto? Override { get; set; }
    public string? Source { get; set; }
}

public sealed class PrintLogEntryDto
{
    public string By { get; set; } = "Unknown";
    public string At { get; set; } = "";
    public string Type { get; set; } = "first_weigh_slip";
    public string? Reason { get; set; }
    public int? CopyNumber { get; set; }
}

public sealed class TicketOverrideDto
{
    public string Reason { get; set; } = "";
    public string Operator { get; set; } = "";
    public string Timestamp { get; set; } = "";
    public string? AnomalyDetails { get; set; }
}
