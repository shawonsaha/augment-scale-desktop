namespace AugmentScale.Models;

public sealed class SetupConfig
{
    public OrganizationSetup Organization { get; set; } = new();
    public SiteSetup Site { get; set; } = new();
    public WeighbridgeSetup Weighbridge { get; set; } = new();
    public ScaleConnectionSetup ScaleConnection { get; set; } = new();
    public CloudSetup Cloud { get; set; } = new();
    public List<OperatorSetup> Operators { get; set; } = DefaultOperators();

    public static List<OperatorSetup> DefaultOperators() =>
    [
        new() { Id = "mr", Code = "MR", DisplayName = "MD. RAJU", FirstName = "Raju", Role = "Supervisor", Shift = "Shift A", Color = "#4C7875", Avatar = "avatars/frame-5.svg", Pin = "1234" },
    ];
}

public sealed class CloudSetup
{
    public string SupabaseUrl { get; set; } = "https://fydikuezxmbjnkjyskwi.supabase.co";
    public string SupabaseAnonKey { get; set; } = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5ZGlrdWV6eG1iam5ranlza3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTI5MzgsImV4cCI6MjEwODcyODkzOH0.mzqkNMSr1MhOsRAKK-CBMTzh59cZHJs7H6LTNxk2z78";
    public int HeartbeatIntervalSeconds { get; set; } = 3600; // 1 hour
    public int LicenseGraceDays { get; set; } = 30; // 30 days
}

public sealed class OrganizationSetup
{
    public string Name { get; set; } = "Augment Ship Recycling";
    public string Address { get; set; } = "Postogola, Dhaka, Bangladesh";
    public string Phone { get; set; } = "+8801626524550";
    public string Email { get; set; } = "augmentscale@bdix.anonaddy.com";
}

public sealed class SiteSetup
{
    public string Name { get; set; } = "Main Yard";
    public string Timezone { get; set; } = "Asia/Dhaka";
    public string Address { get; set; } = "Postogola, Dhaka";
}

public sealed class WeighbridgeSetup
{
    public string Name { get; set; } = "Weighbridge 1";
    public int MaxCapacityKg { get; set; } = 99999;
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
    public string Avatar { get; set; } = "avatars/frame-5.svg";
    public string Pin { get; set; } = "1234";
}

public sealed class AppSecrets
{
    public string DatabaseKey { get; set; } = "";
    public Dictionary<string, string> PinHashes { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}
