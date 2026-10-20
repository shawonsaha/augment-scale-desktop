using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using AugmentScale.ScaleSimulator.Simulation;

namespace AugmentScale.ScaleSimulator;

public sealed class SimulatorSettings
{
    public int Port { get; set; } = 9876;
    public int Fps { get; set; } = 15;
    public double TargetKg { get; set; } = 735;
    public SimulatorScenario Scenario { get; set; } = SimulatorScenario.Manual;
    public bool Motion { get; set; }

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    private static string DataDirectory
    {
        get
        {
            var overrideDirectory = Environment.GetEnvironmentVariable("AUGMENTSCALE_DATA_DIR");
            return !string.IsNullOrWhiteSpace(overrideDirectory)
                ? Path.GetFullPath(overrideDirectory)
                : Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "AugmentScale");
        }
    }

    private static string FilePath => Path.Combine(DataDirectory, "simulator.json");

    public static SimulatorSettings Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return new SimulatorSettings();
            var json = File.ReadAllText(FilePath);
            var settings = JsonSerializer.Deserialize<SimulatorSettings>(json, Json);
            return settings ?? new SimulatorSettings();
        }
        catch
        {
            return new SimulatorSettings();
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, Json));
        }
        catch
        {
            // Settings are a convenience; losing them must not break the simulator.
        }
    }
}
