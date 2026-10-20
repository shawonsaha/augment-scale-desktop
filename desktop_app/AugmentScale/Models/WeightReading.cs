namespace AugmentScale.Models;

public sealed class WeightReading
{
    public double WeightKg { get; set; }
    public string RawDigits { get; set; } = string.Empty;
    public string Sign { get; set; } = "+";
    public int DecimalCount { get; set; }
    public bool ChecksumValid { get; set; }
    public string? ChecksumExpected { get; set; }
    public string? ChecksumActual { get; set; }
    public string RawFrameHex { get; set; } = string.Empty;
    public bool IsStable { get; set; }
    public double StabilityVariance { get; set; }
    public int StabilitySampleCount { get; set; }
    public int StabilityWindowMs { get; set; }
    public double StabilityToleranceKg { get; set; }
    public string Source { get; set; } = "hardware";
    public DateTimeOffset CapturedAt { get; set; } = DateTimeOffset.Now;

    public double NetWeight => Math.Abs(WeightKg);
}
