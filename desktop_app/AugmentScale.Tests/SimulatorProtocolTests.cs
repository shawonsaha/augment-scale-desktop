using System.Net;
using System.Net.Sockets;
using AugmentScale.Models;
using AugmentScale.Protocol;
using AugmentScale.Services;
using Xunit;

namespace AugmentScale.Tests;

public class Xk3190FrameEncoderTests
{
    [Theory]
    [InlineData(0, 0)]
    [InlineData(5, 0)]
    [InlineData(735, 0)]
    [InlineData(12000, 0)]
    [InlineData(28450, 0)]
    [InlineData(999999, 0)]
    [InlineData(-5000, 0)]
    [InlineData(12.34, 2)]
    [InlineData(-12.34, 2)]
    [InlineData(7.5, 1)]
    public void Build_DecodeRoundTrip(double value, int decimals)
    {
        var frame = Xk3190FrameEncoder.Build(value, decimals);

        Assert.Equal(12, frame.Length);
        Assert.Equal(Xk3190FrameDecoder.STX, frame[0]);
        Assert.Equal(Xk3190FrameDecoder.ETX, frame[11]);

        var decoded = Xk3190FrameDecoder.Decode(frame);

        Assert.NotNull(decoded);
        Assert.Equal(value, decoded!.Value, 6);
        Assert.Equal(decimals, decoded.DecimalCount);
        Assert.True(decoded.ChecksumValid);
    }

    [Fact]
    public void Build_CorruptChecksum_IsDetected()
    {
        var frame = Xk3190FrameEncoder.Build(1234, 0, corruptChecksum: true);

        var decoded = Xk3190FrameDecoder.Decode(frame);

        Assert.NotNull(decoded);
        Assert.False(decoded!.ChecksumValid);
        Assert.Equal(1234, decoded.Value, 6);
    }

    [Fact]
    public void Build_ClampsToSixDigits()
    {
        var frame = Xk3190FrameEncoder.Build(1_500_000, 0);

        var decoded = Xk3190FrameDecoder.Decode(frame);

        Assert.NotNull(decoded);
        Assert.Equal(Xk3190FrameEncoder.MaxDigits, decoded!.Value, 6);
        Assert.True(decoded.ChecksumValid);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(5)]
    public void Build_InvalidDecimals_Throws(int decimals)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Xk3190FrameEncoder.Build(100, decimals));
    }

    [Fact]
    public void Build_StreamSurvivesFrameSplitter()
    {
        var splitter = new Xk3190FrameSplitter();
        var packet = Xk3190FrameEncoder.Build(12000)
            .Concat(Xk3190FrameEncoder.Build(5000))
            .ToArray();

        var frames = splitter.Feed(packet);

        Assert.Equal(2, frames.Count);
        Assert.Equal(12000, Xk3190FrameDecoder.Decode(frames[0])!.Value, 6);
        Assert.Equal(5000, Xk3190FrameDecoder.Decode(frames[1])!.Value, 6);
    }
}

public class ScaleReaderTcpTransportTests
{
    [Theory]
    [InlineData("TCP:9876", "127.0.0.1", 9876)]
    [InlineData("TCP:127.0.0.1:9876", "127.0.0.1", 9876)]
    [InlineData("tcp:localhost:9999", "localhost", 9999)]
    public void TryParseTcp_ValidNames(string portName, string host, int port)
    {
        Assert.True(ScaleReaderService.TryParseTcp(portName, out var parsedHost, out var parsedPort));
        Assert.Equal(host, parsedHost);
        Assert.Equal(port, parsedPort);
    }

    [Theory]
    [InlineData("COM1")]
    [InlineData("SIM")]
    [InlineData("TCP:")]
    [InlineData("TCP:0")]
    [InlineData("TCP:70000")]
    [InlineData("TCP:host:notaport")]
    [InlineData("")]
    public void TryParseTcp_InvalidNames(string portName)
    {
        Assert.False(ScaleReaderService.TryParseTcp(portName, out _, out _));
    }

    [Fact]
    public async Task TcpTransport_PublishesDecodedReadings()
    {
        using var temp = new TempDatabase();

        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        temp.Config.Setup.ScaleConnection.PortName = $"TCP:127.0.0.1:{port}";
        temp.Config.Setup.ScaleConnection.StabilityWindowMs = 100;
        temp.Config.Setup.ScaleConnection.StabilityToleranceKg = 10;

        using var reader = new ScaleReaderService(temp.Config, temp.Database);
        var received = new TaskCompletionSource<WeightReading>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        reader.ReadingReceived += (_, reading) => received.TrySetResult(reading);

        reader.Start();

        using var client = await listener.AcceptTcpClientAsync().WaitAsync(TimeSpan.FromSeconds(5));
        var stream = client.GetStream();
        for (var i = 0; i < 5; i++)
        {
            await stream.WriteAsync(Xk3190FrameEncoder.Build(12000));
            await stream.FlushAsync();
            await Task.Delay(40);
        }

        var reading = await received.Task.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(12000, reading.WeightKg, 6);
        Assert.Equal("simulator", reading.Source);
        Assert.True(reading.ChecksumValid);
        Assert.Equal(0, reading.DecimalCount);

        reader.Stop();
        listener.Stop();
    }
}
