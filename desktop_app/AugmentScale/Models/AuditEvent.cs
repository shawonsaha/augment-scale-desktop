namespace AugmentScale.Models;

public sealed class AuditEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string? BeforeValues { get; set; }
    public string? AfterValues { get; set; }
    public string? ChangedFields { get; set; }
    public string? ActorUserId { get; set; }
    public string? ActorRole { get; set; }
    public string? ActorDisplayName { get; set; }
    public string Source { get; set; } = "workstation";
    public string? WorkstationId { get; set; }
    public string? ClientEventId { get; set; }
    public string? ChangeReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
}

public sealed class ScaleHealthEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = string.Empty;
    public string WorkstationId { get; set; } = string.Empty;
    public string WeighbridgeId { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;
    public string? Details { get; set; }
    public DateTimeOffset OccurredAt { get; set; } = DateTimeOffset.Now;
}

public sealed class OutboxEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string EntityType { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;
    public string Operation { get; set; } = "insert";
    public int? BaseRowVersion { get; set; }
    public string Payload { get; set; } = "{}";
    public string WorkstationId { get; set; } = string.Empty;
    public string OperatorId { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string Status { get; set; } = "pending";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
}
