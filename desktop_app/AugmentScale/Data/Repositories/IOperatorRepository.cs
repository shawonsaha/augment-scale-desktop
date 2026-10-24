using AugmentScale.Models;
using AugmentScale.Models.Commands;

namespace AugmentScale.Data.Repositories;

public interface IOperatorRepository
{
    IReadOnlyList<ProfileDto> GetOperators();
    ProfileDto? AuthenticateOperator(string profileId, string pin);
    ProfileDto? AuthenticateSupervisor(string profileId, string pin);
    ProfileDto CreateProfile(ProfileWriteRequest request, string actorId, string actorName);
    ProfileDto UpdateProfile(ProfileWriteRequest request, string actorId, string actorName);
    bool SetProfilePin(SetProfilePinRequest request, string actorId, string actorName);
    bool DeactivateProfile(DeactivateProfileRequest request, string actorId, string actorName);
}
