using System.Globalization;
using System.Text;

namespace AugmentScale.ScaleSimulator.Simulation;

public enum SimulatorScenario
{
    Manual,
    Steady,
    Ramp,
    LoadCycle,
    Jitter,
    TareCycle,
    BadChecksum,
    Garbage,
    OtherFormat,
}

public enum SimulatorFrameKind
{
    Weight,
    CorruptWeight,
    Garbage,
    OtherFormat,
}

public readonly record struct SimulatorFrame(
    SimulatorFrameKind Kind,
    double WeightKg,
    byte[]? RawBytes);

public sealed record ScenarioOption(SimulatorScenario Value, string Label, string Description);

public static class ScenarioCatalog
{
    public static IReadOnlyList<ScenarioOption> All { get; } =
    [
        new(SimulatorScenario.Manual, "Manual", "You set the target and use the buttons."),
        new(SimulatorScenario.Steady, "Steady", "Parked truck: holds the target weight."),
        new(SimulatorScenario.Ramp, "Ramp", "Weight grows from 0 to the target over 10 s."),
        new(SimulatorScenario.LoadCycle, "Load cycle", "Empty, drive on, settle, hold, drive off (20 s loop)."),
        new(SimulatorScenario.Jitter, "Jitter", "Unstable reading: target +/- 5 percent noise."),
        new(SimulatorScenario.TareCycle, "Tare cycle", "Gross, tare, negative net, zero (16 s loop)."),
        new(SimulatorScenario.BadChecksum, "Bad checksum", "Every 4th frame carries a corrupt checksum."),
        new(SimulatorScenario.Garbage, "Garbage", "Junk and truncated frames injected into the stream."),
        new(SimulatorScenario.OtherFormat, "Other format", "Yaohua '=12345' lines with CRLF, no checksum."),
    ];
}

public sealed class SimulatorEngine
{
    public const double DivisionKg = 5;
    private const double MaxWeightKg = 999_995;

    private readonly object _gate = new();
    private readonly Random _random;
    private SimulatorScenario _scenario = SimulatorScenario.Manual;
    private double _target = 735;
    private double _displayed = 735;
    private DateTimeOffset? _lastTick;
    private DateTimeOffset? _scenarioStart;
    private bool _manualMotion;
    private bool _lastMotion;
    private long _frameNumber;
    private double _lastWeight = 735;

    public SimulatorEngine(int seed = 20261021)
    {
        _random = new Random(seed);
    }

    public void SetTarget(double targetKg)
    {
        if (!double.IsFinite(targetKg)) return;

        lock (_gate)
        {
            _target = Math.Clamp(targetKg, -MaxWeightKg, MaxWeightKg);
        }
    }

    public void Nudge(double deltaKg)
    {
        lock (_gate)
        {
            _target = Math.Clamp(_target + deltaKg, -MaxWeightKg, MaxWeightKg);
        }
    }

    public void SetMotion(bool motion)
    {
        lock (_gate)
        {
            _manualMotion = motion;
        }
    }

    public void SetScenario(SimulatorScenario scenario)
    {
        lock (_gate)
        {
            _scenario = scenario;
            _scenarioStart = null;
            _lastTick = null;
            _frameNumber = 0;
            _displayed = scenario is SimulatorScenario.Ramp or SimulatorScenario.LoadCycle
                ? 0
                : _target;
        }
    }

    public SimulatorSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new SimulatorSnapshot(
                Math.Round(_lastWeight),
                Math.Round(_target),
                _scenario,
                _lastMotion || _manualMotion,
                _frameNumber);
        }
    }

    public IReadOnlyList<SimulatorFrame> Tick(DateTimeOffset now)
    {
        lock (_gate)
        {
            var elapsed = _lastTick is null
                ? 0
                : Math.Clamp((now - _lastTick.Value).TotalSeconds, 0, 0.5);
            _lastTick = now;
            _frameNumber++;

            var desired = DesiredWeight(now, out var autoMotion);
            var approach = 1 - Math.Exp(-elapsed / 0.22);
            _displayed += (desired - _displayed) * approach;

            var motion = _manualMotion || autoMotion;
            _displayed += motion
                ? (_random.NextDouble() - 0.5) * 90
                : (_random.NextDouble() - 0.5) * 2;

            var quantized = Quantize(_displayed);
            _lastWeight = quantized;
            _lastMotion = motion;

            return BuildFrames(quantized);
        }
    }

    private IReadOnlyList<SimulatorFrame> BuildFrames(double weight)
    {
        if (_scenario == SimulatorScenario.Garbage)
        {
            var frames = new List<SimulatorFrame>(4);
            if (_frameNumber % 7 == 0)
                frames.Add(new SimulatorFrame(
                    SimulatorFrameKind.Garbage,
                    weight,
                    [0x02, (byte)'J', (byte)'U', (byte)'N', (byte)'K', 0x03]));
            if (_frameNumber % 11 == 0)
                frames.Add(new SimulatorFrame(
                    SimulatorFrameKind.Garbage,
                    weight,
                    Encoding.ASCII.GetBytes("\x02+000123")));
            if (_frameNumber % 13 == 0)
                frames.Add(new SimulatorFrame(
                    SimulatorFrameKind.Garbage,
                    weight,
                    Encoding.ASCII.GetBytes("noise line\r\n")));
            frames.Add(new SimulatorFrame(SimulatorFrameKind.Weight, weight, null));
            return frames;
        }

        if (_scenario == SimulatorScenario.OtherFormat)
        {
            var text = $"={weight.ToString("0", CultureInfo.InvariantCulture)}\r\n";
            return [new SimulatorFrame(
                SimulatorFrameKind.OtherFormat,
                weight,
                Encoding.ASCII.GetBytes(text))];
        }

        if (_scenario == SimulatorScenario.BadChecksum && _frameNumber % 4 == 3)
            return [new SimulatorFrame(SimulatorFrameKind.CorruptWeight, weight, null)];

        return [new SimulatorFrame(SimulatorFrameKind.Weight, weight, null)];
    }

    private double DesiredWeight(DateTimeOffset now, out bool autoMotion)
    {
        _scenarioStart ??= now;
        autoMotion = false;
        switch (_scenario)
        {
            case SimulatorScenario.LoadCycle:
                return LoadCycle(now, out autoMotion);

            case SimulatorScenario.Ramp:
            {
                var t = (now - _scenarioStart!.Value).TotalSeconds;
                autoMotion = t < 10;
                return _target * Smooth(t / 10);
            }

            case SimulatorScenario.Jitter:
                autoMotion = true;
                return _target + (_random.NextDouble() - 0.5) * 0.1 * Math.Abs(_target);

            case SimulatorScenario.TareCycle:
                return TareCycle(now);

            case SimulatorScenario.Steady:
            case SimulatorScenario.BadChecksum:
            case SimulatorScenario.Garbage:
            case SimulatorScenario.OtherFormat:
            case SimulatorScenario.Manual:
            default:
                return _target;
        }
    }

    private double LoadCycle(DateTimeOffset now, out bool autoMotion)
    {
        var t = (now - _scenarioStart!.Value).TotalSeconds % 20;
        autoMotion = false;
        if (t < 2) return 0;
        if (t < 5)
        {
            autoMotion = true;
            return _target * Smooth((t - 2) / 3);
        }
        if (t < 7)
        {
            autoMotion = true;
            var d = t - 5;
            return _target * (1 + 0.06 * Math.Exp(-2.2 * d) * Math.Sin(14 * d));
        }
        if (t < 14) return _target;
        if (t < 17)
        {
            autoMotion = true;
            return _target * (1 - Smooth((t - 14) / 3));
        }
        return 0;
    }

    private double TareCycle(DateTimeOffset now)
    {
        var t = (now - _scenarioStart!.Value).TotalSeconds % 16;
        if (t < 5) return _target;
        if (t < 10) return 0;
        if (t < 13) return -_target;
        return 0;
    }

    private static double Smooth(double progress)
    {
        var p = Math.Clamp(progress, 0, 1);
        return p * p * (3 - 2 * p);
    }

    private static double Quantize(double weightKg)
    {
        var rounded = Math.Round(weightKg / DivisionKg, MidpointRounding.AwayFromZero) * DivisionKg;
        return Math.Abs(rounded) < DivisionKg / 2 ? 0 : rounded;
    }
}

public readonly record struct SimulatorSnapshot(
    double WeightKg,
    double TargetKg,
    SimulatorScenario Scenario,
    bool Motion,
    long FrameNumber);
