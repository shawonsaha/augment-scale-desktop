namespace AugmentScale.Models;

public sealed class SetupConfig
{
    public OrganizationSetup Organization { get; set; } = new();
    public SiteSetup Site { get; set; } = new();
    public WeighbridgeSetup Weighbridge { get; set; } = new();
    public ScaleConnectionSetup ScaleConnection { get; set; } = new();
    public List<OperatorSetup> Operators { get; set; } = DefaultOperators();

    public static List<OperatorSetup> DefaultOperators() =>
    [
        new() { Id = "mr", Code = "MR", DisplayName = "MD. RAJU", FirstName = "Raju", Role = "Supervisor", Shift = "Shift A", Color = "#4C7875", Avatar = "avatars/frame-9.svg", Pin = "1234" },
        new() { Id = "ak", Code = "AK", DisplayName = "AKHTER K.", FirstName = "Akhter", Role = "Senior Operator", Shift = "Shift A", Color = "#FB9550", Avatar = "avatars/frame-4.svg", Pin = "1234" },
        new() { Id = "sh", Code = "SH", DisplayName = "SHAFIQ H.", FirstName = "Shafiq", Role = "Operator", Shift = "Shift B", Color = "#475569", Avatar = "avatars/frame-3.svg", Pin = "1234" },
        new() { Id = "rh", Code = "RH", DisplayName = "RAHIM A.", FirstName = "Rahim", Role = "Operator", Shift = "Shift C", Color = "#F2C2B6", Avatar = "avatars/frame-1.svg", Pin = "1234" },
        new() { Id = "kh", Code = "KH", DisplayName = "KAMAL H.", FirstName = "Kamal", Role = "Relief Operator", Shift = "Shift B", Color = "#526E7E", Avatar = "avatars/frame-5.svg", Pin = "1234" },
    ];
}

public sealed class OrganizationSetup
{
    public string Name { get; set; } = "Meghna Ship Recycling";
    public string Address { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
}

public sealed class SiteSetup
{
    public string Name { get; set; } = "Main Yard";
    public string Timezone { get; set; } = "Asia/Dhaka";
    public string Address { get; set; } = "";
}

public sealed class WeighbridgeSetup
{
    public string Name { get; set; } = "Weighbridge 1";
    public int MaxCapacityKg { get; set; } = 60000;
    public int MinDivisionKg { get; set; } = 5;
}

public sealed class ScaleConnectionSetup
{
    public string PortName { get; set; } = "COM1";
    public int BaudRate { get; set; } = 9600;
    public int DataBits { get; set; } = 8;
    public string Parity { get; set; } = "None";
    public int StopBits { get; set; } = 1;
    public string ProtocolFormat { get; set; } = "yaohua_format_1";
    public int StabilityWindowMs { get; set; } = 500;
    public double StabilityToleranceKg { get; set; } = 10;
    public double SimulatorTargetKg { get; set; } = 735;
}

public sealed class OperatorSetup
{
    public string Id { get; set; } = "";
    public string Code { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string FirstName { get; set; } = "";
    public string Role { get; set; } = "Operator";
    public string Shift { get; set; } = "Shift A";
    public string Color { get; set; } = "#4C7875";
    public string Avatar { get; set; } = "avatars/frame-9.svg";
    public string Pin { get; set; } = "1234";
}

public sealed class AppSecrets
{
    public string DatabaseKey { get; set; } = "";
    public Dictionary<string, string> PinHashes { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}
