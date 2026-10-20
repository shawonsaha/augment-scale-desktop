using System.Text;
using AugmentScale.Protocol;
using Xunit;

namespace AugmentScale.Tests;

public class Xk3190FrameDecoderTests
{
    private static byte[] BuildFrame(string sign, string digits, char dec, bool corruptChecksum = false)
    {
        Assert.Equal(6, digits.Length);
        var payload = Encoding.ASCII.GetBytes(sign + digits + dec);
        var checksum = Xk3190FrameDecoder.ComputeChecksum(payload);
        if (corruptChecksum) checksum[1] = (byte)'0';
        var frame = new byte[12];
        frame[0] = Xk3190FrameDecoder.STX;
        payload.CopyTo(frame, 1);
        checksum.CopyTo(frame, 9);
        frame[11] = Xk3190FrameDecoder.ETX;
        return frame;
    }

    [Fact]
    public void Decode_KnownPositiveFrame_ReturnsWeightAndValidChecksum()
    {
        var frame = BuildFrame("+", "000735", '0');

        var decoded = Xk3190FrameDecoder.Decode(frame);

        Assert.NotNull(decoded);
        Assert.Equal(735, decoded!.Value);
        Assert.Equal(0, decoded.DecimalCount);
        Assert.Equal("+", decoded.Sign);
        Assert.True(decoded.ChecksumValid);
        Assert.Equal("format1", decoded.Kind);
        Assert.Equal("000735", decoded.RawDigits);
    }

    [Fact]
    public void Decode_NegativeFrame_ReturnsNegativeValue()
    {
        var decoded = Xk3190FrameDecoder.Decode(BuildFrame("-", "000120", '2'));

        Assert.NotNull(decoded);
        Assert.Equal(-1.2, decoded!.Value, 6);
        Assert.Equal("-", decoded.Sign);
        Assert.True(decoded.ChecksumValid);
    }

    [Fact]
    public void Decode_CorruptChecksum_FlagsFrame()
    {
        var decoded = Xk3190FrameDecoder.Decode(BuildFrame("+", "001000", '1', corruptChecksum: true));

        Assert.NotNull(decoded);
        Assert.False(decoded!.ChecksumValid);
    }

    [Fact]
    public void Decode_OtherFormat_ExtractsDecimalWeight()
    {
        var frame = Encoding.ASCII.GetBytes("= 735.0\r");

        var decoded = Xk3190FrameDecoder.Decode(frame);

        Assert.NotNull(decoded);
        Assert.Equal(735.0, decoded!.Value, 6);
        Assert.Equal(1, decoded.DecimalCount);
        Assert.Equal("other-format", decoded.Kind);
        Assert.Null(decoded.ChecksumValid);
    }

    [Theory]
    [InlineData(new byte[] { 0x01, 0x02, 0x03 })]
    [InlineData(new byte[] { 0x02, 0x2B, 0x30, 0x30, 0x30, 0x37, 0x33, 0x35, 0x30, 0x30, 0x03 })]
    public void Decode_InvalidFrame_ReturnsNull(byte[] frame)
    {
        Assert.Null(Xk3190FrameDecoder.Decode(frame));
    }
}

public class Xk3190FrameSplitterTests
{
    private static byte[] BuildFrame(string digits)
    {
        var payload = Encoding.ASCII.GetBytes("+" + digits + "0");
        var checksum = Xk3190FrameDecoder.ComputeChecksum(payload);
        var frame = new byte[12];
        frame[0] = Xk3190FrameDecoder.STX;
        payload.CopyTo(frame, 1);
        checksum.CopyTo(frame, 9);
        frame[11] = Xk3190FrameDecoder.ETX;
        return frame;
    }

    [Fact]
    public void Feed_OnePacketWithTwoFrames_ReturnsBoth()
    {
        var splitter = new Xk3190FrameSplitter();
        var packet = BuildFrame("000100").Concat(BuildFrame("000200")).ToArray();

        var frames = splitter.Feed(packet);

        Assert.Equal(2, frames.Count);
        Assert.Equal(100, Xk3190FrameDecoder.Decode(frames[0])!.Value);
        Assert.Equal(200, Xk3190FrameDecoder.Decode(frames[1])!.Value);
    }

    [Fact]
    public void Feed_PartialFrame_IsBufferedUntilCompleted()
    {
        var splitter = new Xk3190FrameSplitter();
        var frame = BuildFrame("000345");

        Assert.Empty(splitter.Feed(frame.AsSpan(0, 5)));
        Assert.Equal(5, splitter.BufferedBytes);

        var frames = splitter.Feed(frame.AsSpan(5));

        Assert.Single(frames);
        Assert.Equal(345, Xk3190FrameDecoder.Decode(frames[0])!.Value);
        Assert.Equal(0, splitter.BufferedBytes);
    }

    [Fact]
    public void Feed_GarbageBeforeFrame_IsDiscarded()
    {
        var splitter = new Xk3190FrameSplitter();
        var packet = new byte[] { 0x41, 0x42, 0xFF }
            .Concat(BuildFrame("000444")).ToArray();

        var frames = splitter.Feed(packet);

        Assert.Single(frames);
        Assert.Equal(444, Xk3190FrameDecoder.Decode(frames[0])!.Value);
    }

    [Fact]
    public void Feed_NewlineDelimitedFrame_IsReturned()
    {
        var splitter = new Xk3190FrameSplitter();

        var frames = splitter.Feed(Encoding.ASCII.GetBytes("= 735.0\r\n"));

        Assert.Single(frames);
        Assert.Equal(735, Xk3190FrameDecoder.Decode(frames[0])!.Value);
    }
}

public class StabilityDetectorTests
{
    [Fact]
    public void Add_RequiresAtLeastThreeSamples()
    {
        var detector = new StabilityDetector();
        var start = DateTimeOffset.Parse("2026-01-01T00:00:00Z");

        Assert.False(detector.Add(500, start).IsStable);
        Assert.False(detector.Add(501, start.AddMilliseconds(100)).IsStable);
        Assert.True(detector.Add(502, start.AddMilliseconds(200)).IsStable);
    }

    [Fact]
    public void Add_VariationAboveTolerance_IsUnstable()
    {
        var detector = new StabilityDetector(500, 10);
        var start = DateTimeOffset.Parse("2026-01-01T00:00:00Z");

        detector.Add(500, start);
        detector.Add(501, start.AddMilliseconds(100));
        detector.Add(502, start.AddMilliseconds(200));
        var result = detector.Add(530, start.AddMilliseconds(300));

        Assert.False(result.IsStable);
        Assert.Equal(30, result.Variance, 6);
    }

    [Fact]
    public void Add_ExpiresSamplesOutsideWindow()
    {
        var detector = new StabilityDetector(500, 10);
        var start = DateTimeOffset.Parse("2026-01-01T00:00:00Z");

        detector.Add(500, start);
        detector.Add(500, start.AddMilliseconds(100));
        detector.Add(500, start.AddMilliseconds(200));
        var result = detector.Add(500, start.AddMilliseconds(1500));

        Assert.False(result.IsStable);
        Assert.Equal(1, result.SampleCount);
    }
}
