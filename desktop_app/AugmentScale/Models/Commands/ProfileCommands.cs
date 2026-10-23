namespace AugmentScale.Models.Commands;

public sealed class ProfileAdminAuthRequest
{
    public string OperatorId { get; set; } = string.Empty;
    public string Pin { get; set; } = string.Empty;
}

public class ProfileAdminSessionRequest
{
    public string Token { get; set; } = string.Empty;
}

public sealed class ProfileWriteRequest : ProfileAdminSessionRequest
{
    public string Id { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Shift { get; set; } = string.Empty;
    public string Avatar { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public string Pin { get; set; } = string.Empty;
}

public sealed class SetProfilePinRequest : ProfileAdminSessionRequest
{
    public string ProfileId { get; set; } = string.Empty;
    public string Pin { get; set; } = string.Empty;
}

public sealed class DeactivateProfileRequest : ProfileAdminSessionRequest
{
    public string ProfileId { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
}
