namespace AugmentScale.Models;

/// <summary>Shape consumed directly by the prototype login screen.</summary>
public sealed class ProfileDto
{
    public string Id { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string Role { get; set; } = "Operator";
    public string Shift { get; set; } = "Shift A";
    public string Avatar { get; set; } = "avatars/frame-9.svg";
    public string Color { get; set; } = "#4C7875";
    public bool PinSet { get; set; }
}
