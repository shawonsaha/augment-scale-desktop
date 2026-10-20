using System.Text.Json.Serialization;

namespace AugmentScale.Models;

/// <summary>Prototype REGISTERED_TRUCKS record shape.</summary>
public sealed class VehicleDto
{
    [JsonIgnore]
    public string Id { get; set; } = string.Empty;

    public string Plate { get; set; } = string.Empty;
    public string Driver { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Material { get; set; } = string.Empty;
    public string Client { get; set; } = string.Empty;
    public string Status { get; set; } = "active";
    public int TripCount { get; set; }
    public double? LastTare { get; set; }
    public DateTimeOffset? LastWeighed { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public string? ArchivedBy { get; set; }
    public string? ArchivedReason { get; set; }
    public string? RegisteredBy { get; set; }
    public DateTimeOffset? RegisteredAt { get; set; }
    public string? Notes { get; set; }
}
