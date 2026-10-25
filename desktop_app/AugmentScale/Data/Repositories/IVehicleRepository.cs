using AugmentScale.Models;
using AugmentScale.Models.Commands;

namespace AugmentScale.Data.Repositories;

public interface IVehicleRepository
{
    IReadOnlyList<VehicleDto> GetVehicles();
    IReadOnlyList<VehicleDto> GetActiveVehicles();
    VehicleDto RegisterVehicle(VehicleRequest req);
    (bool Ok, string? Error, VehicleDto? Vehicle) ArchiveVehicle(ArchiveVehicleRequest req);
    VehicleDto? RestoreVehicle(ArchiveVehicleRequest req);
    (bool Ok, string? Error) DeleteVehicle(DeleteVehicleRequest req);
}
