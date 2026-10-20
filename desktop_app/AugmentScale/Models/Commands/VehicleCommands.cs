namespace AugmentScale.Models.Commands;

public sealed class VehicleRequest
{
    public string Plate { get; set; } = string.Empty;
    public string Driver { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Material { get; set; } = string.Empty;
    public string Client { get; set; } = string.Empty;
    public string OperatorId { get; set; } = string.Empty;
    public string OperatorName { get; set; } = string.Empty;
}

public sealed class ArchiveVehicleRequest
{
    public string Plate { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public string OperatorId { get; set; } = string.Empty;
    public string OperatorName { get; set; } = string.Empty;
}
