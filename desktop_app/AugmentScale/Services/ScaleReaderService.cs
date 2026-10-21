using System.Globalization;
using System.IO;
using System.IO.Ports;
using System.Net.Sockets;
using AugmentScale.Models;
using AugmentScale.Protocol;

namespace AugmentScale.Services;

/// <summary>
/// Background RS-232/TCP reader for the XK3190-D10. Runs on a dedicated thread,
/// reconnects automatically and publishes stable/unstable readings. A TCP target
/// connects to the standalone scale simulator.
/// </summary>
public sealed class ScaleReaderService : IDisposable
{
    private readonly ConfigService _config;
    private readonly DatabaseService _database;
    private readonly object _stateGate = new();
    private readonly ManualResetEventSlim _stop = new(false);
    private Thread? _thread;
    private volatile bool _running;
    private SerialPort? _port;
    private TcpClient? _tcp;
    private DateTimeOffset _lastHealthLog = DateTimeOffset.MinValue;

    public ScaleReaderService(ConfigService config, DatabaseService database)
    {
        _config = config;
        _database = database;
    }

    public event EventHandler<WeightReading>? ReadingReceived;
    public event EventHandler<ScaleConnectionStatus>? StatusChanged;

    public bool IsConnected { get; private set; }
    public string StatusMessage { get; private set; } = "Not started";
    public string PortName { get; private set; } = "";
    public bool IsSimulator => PortName.StartsWith("TCP:", StringComparison.OrdinalIgnoreCase);
    public WeightReading? LastReading { get; private set; }

    public void Start()
    {
        if (_running) return;
        _running = true;
        _stop.Reset();
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "XK3190 scale reader",
        };
        _thread.Start();
    }

    public void Stop()
    {
        _running = false;
        _stop.Set();
        try { _port?.Close(); } catch { /* ignore */ }
        try { _tcp?.Close(); } catch { /* ignore */ }
        _thread?.Join(TimeSpan.FromSeconds(2));
        SetStatus(false, "Stopped");
    }

    private void Run()
    {
        var settings = _config.Setup.ScaleConnection;
        PortName = settings.PortName;
        while (_running && !_stop.IsSet)
        {
            try
            {
                if (TryParseTcp(settings.PortName, out var host, out var port))
                {
                    RunTcp(settings, host, port);
                }
                else
                {
                    RunSerial(settings);
                }
            }
            catch (Exception ex)
            {
                if (!_running) break;
                SetStatus(false, DescribePortError(settings.PortName, ex));
                LogHealth("port_error", $"{settings.PortName}: {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                try { _port?.Dispose(); } catch { /* ignore */ }
                _port = null;
                try { _tcp?.Dispose(); } catch { /* ignore */ }
                _tcp = null;
            }

            if (_running) _stop.Wait(TimeSpan.FromSeconds(3));
        }
    }

    private void RunSerial(ScaleConnectionSetup settings)
    {
        var port = new SerialPort(settings.PortName, settings.BaudRate)
        {
            DataBits = settings.DataBits,
            Parity = Enum.TryParse<Parity>(settings.Parity, true, out var parity) ? parity : Parity.None,
            StopBits = settings.StopBits switch
            {
                2 => StopBits.Two,
                0 => StopBits.None,
                _ => StopBits.One,
            },
            ReadTimeout = 500,
            WriteTimeout = 500,
            DtrEnable = true,
            RtsEnable = true,
        };

        port.Open();
        _port = port;
        SetStatus(true, $"{settings.PortName} connected");
        LogHealth("connected", $"{settings.PortName} @ {settings.BaudRate} baud");
        ProcessStream(port.BaseStream, settings, "hardware");
    }

    private void RunTcp(ScaleConnectionSetup settings, string host, int port)
    {
        using var client = new TcpClient { NoDelay = true };
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        client.ConnectAsync(host, port, timeout.Token).GetAwaiter().GetResult();
        _tcp = client;
        SetStatus(true, $"Simulator {host}:{port} connected");
        LogHealth("connected", $"simulator tcp {host}:{port}");
        ProcessStream(client.GetStream(), settings, "simulator");
    }

    private void ProcessStream(Stream stream, ScaleConnectionSetup settings, string source)
    {
        var splitter = new Xk3190FrameSplitter();
        var detector = new StabilityDetector(settings.StabilityWindowMs, settings.StabilityToleranceKg);
        var buffer = new byte[256];
        var invalidFrames = 0;

        while (_running && !_stop.IsSet)
        {
            var read = stream.Read(buffer, 0, buffer.Length);
            if (read <= 0)
            {
                if (stream is NetworkStream)
                    throw new IOException("The simulator closed the connection.");
                continue;
            }

            foreach (var frame in splitter.Feed(buffer.AsSpan(0, read)))
            {
                var decoded = Xk3190FrameDecoder.Decode(frame);
                if (decoded is null) continue;
                if (decoded.ChecksumValid == false)
                {
                    invalidFrames++;
                    if (invalidFrames % 25 == 1)
                        LogHealth("checksum_error", $"Invalid checksum: {decoded.RawFrameHex}");
                    continue;
                }

                var stability = detector.Add(decoded.Value);
                Publish(new WeightReading
                {
                    WeightKg = decoded.Value,
                    RawDigits = decoded.RawDigits,
                    Sign = decoded.Sign,
                    DecimalCount = decoded.DecimalCount,
                    ChecksumValid = decoded.ChecksumValid == true,
                    ChecksumExpected = decoded.ChecksumExpected,
                    ChecksumActual = decoded.ChecksumActual,
                    RawFrameHex = decoded.RawFrameHex,
                    IsStable = stability.IsStable,
                    StabilityVariance = stability.Variance,
                    StabilitySampleCount = stability.SampleCount,
                    StabilityWindowMs = stability.WindowMs,
                    StabilityToleranceKg = stability.ToleranceKg,
                    Source = source,
                    CapturedAt = DateTimeOffset.Now,
                });
            }
        }
    }

    private void Publish(WeightReading reading)
    {
        LastReading = reading;
        ReadingReceived?.Invoke(this, reading);
    }

    private void SetStatus(bool connected, string message)
    {
        lock (_stateGate)
        {
            if (IsConnected == connected && StatusMessage == message) return;
            IsConnected = connected;
            StatusMessage = message;
        }
        StatusChanged?.Invoke(this, new ScaleConnectionStatus(connected, message, IsSimulator, PortName));
    }

    private void LogHealth(string eventType, string details)
    {
        if (DateTimeOffset.Now - _lastHealthLog < TimeSpan.FromSeconds(5)) return;
        _lastHealthLog = DateTimeOffset.Now;
        try { _database.RecordScaleHealth(eventType, details); }
        catch { /* health logging must never take the reader down */ }
    }

    public static bool TryParseTcp(string? portName, out string host, out int port)
    {
        host = "127.0.0.1";
        port = 0;
        if (string.IsNullOrWhiteSpace(portName) ||
            !portName.StartsWith("TCP:", StringComparison.OrdinalIgnoreCase))
            return false;

        var rest = portName[4..].Trim();
        if (rest.Length == 0) return false;

        var colon = rest.LastIndexOf(':');
        if (colon < 0)
        {
            return int.TryParse(rest, NumberStyles.None, CultureInfo.InvariantCulture, out port) &&
                   port is > 0 and <= 65535;
        }

        host = rest[..colon].Trim();
        if (host.Length == 0) host = "127.0.0.1";
        return int.TryParse(rest[(colon + 1)..], NumberStyles.None, CultureInfo.InvariantCulture, out port) &&
               port is > 0 and <= 65535;
    }

    private static string DescribePortError(string portName, Exception ex)
    {
        if (portName.StartsWith("TCP:", StringComparison.OrdinalIgnoreCase))
        {
            return ex switch
            {
                SocketException => $"Simulator connection failed: {ex.Message}",
                TimeoutException or OperationCanceledException =>
                    "Simulator connection timed out. Is the simulator running?",
                IOException => "Simulator connection closed. Waiting for the simulator...",
                _ => $"Simulator: {ex.Message}",
            };
        }

        return ex switch
        {
            UnauthorizedAccessException => $"{portName} is already in use by another program.",
            IOException => $"{portName} is unavailable. Check the cable and indicator power.",
            ArgumentException => $"{portName} is not a valid serial port name.",
            _ => $"{portName}: {ex.Message}",
        };
    }

    public void Dispose()
    {
        Stop();
        _stop.Dispose();
    }
}

public sealed record ScaleConnectionStatus(bool Connected, string Message, bool IsSimulator, string PortName);
