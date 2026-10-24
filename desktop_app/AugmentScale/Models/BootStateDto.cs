namespace AugmentScale.Models;

public sealed record BootStateDto
{
    public IReadOnlyList<ProfileDto> Operators { get; init; } = Array.Empty<ProfileDto>();
    public IReadOnlyList<VehicleDto> Vehicles { get; init; } = Array.Empty<VehicleDto>();
    public IReadOnlyList<TicketDto> Pending { get; init; } = Array.Empty<TicketDto>();
    public IReadOnlyList<TicketDto> History { get; init; } = Array.Empty<TicketDto>();
    public long NextTicketNumber { get; init; }
    public SyncStatusDto Sync { get; init; } = new();
}
