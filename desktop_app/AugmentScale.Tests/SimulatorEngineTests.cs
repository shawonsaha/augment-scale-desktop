using System.Text;
using AugmentScale.ScaleSimulator.Simulation;
using Xunit;

namespace AugmentScale.Tests;

public class SimulatorEngineTests
{
    private static readonly DateTimeOffset Start = DateTimeOffset.Parse("2026-01-01T00:00:00Z");

    private static IReadOnlyList<SimulatorFrame> Run(
        SimulatorEngine engine, int ticks, int intervalMs = 66)
    {
        var frames = new List<SimulatorFrame>();
        for (var i = 0; i < ticks; i++)
        {
            frames.AddRange(engine.Tick(Start.AddMilliseconds(i * intervalMs)));
        }
        return frames;
    }

    [Fact]
    public void Manual_QuantizesToFiveKilograms()
    {
        var engine = new SimulatorEngine(seed: 1);
        engine.SetTarget(12347);

        Run(engine, 200);

        var snapshot = engine.Snapshot();
        Assert.Equal(0, snapshot.WeightKg % 5);
        Assert.InRange(snapshot.WeightKg, 12340, 12350);
    }

    [Fact]
    public void Manual_TargetCanBeNegative()
    {
        var engine = new SimulatorEngine(seed: 2);
        engine.SetTarget(-500);

        Run(engine, 200);

        Assert.Equal(-500, engine.Snapshot().WeightKg);
    }

    [Fact]
    public void BadChecksum_FlagsEveryFourthFrame()
    {
        var engine = new SimulatorEngine(seed: 3);
        engine.SetTarget(1000);
        engine.SetScenario(SimulatorScenario.BadChecksum);

        var frames = Run(engine, 8);

        Assert.Equal(8, frames.Count);
        Assert.Equal(SimulatorFrameKind.CorruptWeight, frames[2].Kind);
        Assert.Equal(SimulatorFrameKind.CorruptWeight, frames[6].Kind);
        Assert.Equal(SimulatorFrameKind.Weight, frames[0].Kind);
    }

    [Fact]
    public void Garbage_InjectsExtraRawFrames()
    {
        var engine = new SimulatorEngine(seed: 4);
        engine.SetTarget(1000);
        engine.SetScenario(SimulatorScenario.Garbage);

        var frames = Run(engine, 13);

        Assert.Contains(frames, f => f.Kind == SimulatorFrameKind.Garbage);
        Assert.Contains(frames, f => f.Kind == SimulatorFrameKind.Weight);
    }

    [Fact]
    public void OtherFormat_ProducesYaohuaTextLine()
    {
        var engine = new SimulatorEngine(seed: 5);
        engine.SetTarget(12345);
        engine.SetScenario(SimulatorScenario.OtherFormat);

        var frame = Assert.Single(Run(engine, 1));

        Assert.Equal(SimulatorFrameKind.OtherFormat, frame.Kind);
        var text = Encoding.ASCII.GetString(frame.RawBytes!);
        Assert.StartsWith("=", text);
        Assert.EndsWith("\r\n", text);
        Assert.Equal(12345, frame.WeightKg);
    }

    [Fact]
    public void TareCycle_ProducesPositiveAndNegativeWeights()
    {
        var engine = new SimulatorEngine(seed: 6);
        engine.SetTarget(1000);
        engine.SetScenario(SimulatorScenario.TareCycle);

        var weights = Run(engine, 300)
            .Where(f => f.Kind == SimulatorFrameKind.Weight)
            .Select(f => f.WeightKg)
            .ToList();

        Assert.Contains(weights, w => w > 0);
        Assert.Contains(weights, w => w < 0);
    }

    [Fact]
    public void LoadCycle_SettlesNearTargetThenReturnsToZero()
    {
        var engine = new SimulatorEngine(seed: 7);
        engine.SetTarget(12000);
        engine.SetScenario(SimulatorScenario.LoadCycle);

        var frames = Run(engine, 320);
        var weights = frames
            .Where(f => f.Kind == SimulatorFrameKind.Weight)
            .Select(f => f.WeightKg)
            .ToList();

        Assert.Contains(weights, w => w >= 11990 && w <= 12010);
        Assert.Contains(weights, w => w == 0);
    }

    [Fact]
    public void Motion_AddsVariation()
    {
        var engine = new SimulatorEngine(seed: 8);
        engine.SetTarget(5000);
        engine.SetMotion(true);

        var weights = Run(engine, 120)
            .Where(f => f.Kind == SimulatorFrameKind.Weight)
            .Select(f => f.WeightKg)
            .ToList();

        Assert.True(weights.Max() - weights.Min() > 10);
    }
}
