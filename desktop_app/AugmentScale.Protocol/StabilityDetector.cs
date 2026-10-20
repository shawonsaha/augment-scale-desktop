namespace AugmentScale.Protocol;

/// <summary>
/// Rolling time-window stability detector. A reading is stable when the
/// window contains at least three samples and max-min is within tolerance.
/// </summary>
public sealed class StabilityDetector
{
    private readonly Queue<(DateTimeOffset At, double Weight)> _window = new();
    private readonly int _windowMs;
    private readonly double _toleranceKg;

    public StabilityDetector(int windowMs = 500, double toleranceKg = 10)
    {
        _windowMs = Math.Max(100, windowMs);
        _toleranceKg = Math.Max(0, toleranceKg);
    }

    public int WindowMs => _windowMs;
    public double ToleranceKg => _toleranceKg;
    public int SampleCount => _window.Count;
    public double Variance { get; private set; }
    public bool IsStable { get; private set; }

    public StabilityResult Add(double weightKg, DateTimeOffset? capturedAt = null)
    {
        var now = capturedAt ?? DateTimeOffset.Now;
        _window.Enqueue((now, weightKg));
        while (_window.Count > 0 && (now - _window.Peek().At).TotalMilliseconds > _windowMs)
        {
            _window.Dequeue();
        }

        if (_window.Count < 3)
        {
            Variance = 0;
            IsStable = false;
            return Snapshot(weightKg);
        }

        var min = double.MaxValue;
        var max = double.MinValue;
        foreach (var sample in _window)
        {
            if (sample.Weight < min) min = sample.Weight;
            if (sample.Weight > max) max = sample.Weight;
        }

        Variance = max - min;
        IsStable = Variance <= _toleranceKg;
        return Snapshot(weightKg);
    }

    public void Reset()
    {
        _window.Clear();
        Variance = 0;
        IsStable = false;
    }

    private StabilityResult Snapshot(double weightKg) => new(
        weightKg,
        IsStable,
        Variance,
        _window.Count,
        _windowMs,
        _toleranceKg);
}

public readonly record struct StabilityResult(
    double WeightKg,
    bool IsStable,
    double Variance,
    int SampleCount,
    int WindowMs,
    double ToleranceKg);
