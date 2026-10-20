using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;
using AugmentScale.Protocol;
using AugmentScale.ScaleSimulator.Networking;
using AugmentScale.ScaleSimulator.Simulation;

namespace AugmentScale.ScaleSimulator;

public partial class MainWindow : Window
{
    private static readonly Brush StableBackground = new SolidColorBrush(Color.FromRgb(0x12, 0x35, 0x2F));
    private static readonly Brush StableForeground = new SolidColorBrush(Color.FromRgb(0x2D, 0xD4, 0xBF));
    private static readonly Brush MotionBackground = new SolidColorBrush(Color.FromRgb(0x3A, 0x2A, 0x05));
    private static readonly Brush MotionForeground = new SolidColorBrush(Color.FromRgb(0xF5, 0x9E, 0x0B));
    private static readonly Brush IdleForeground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8));

    private readonly SimulatorEngine _engine = new();
    private readonly TcpFrameServer _server = new();
    private readonly SimulatorSettings _settings;
    private readonly StringBuilder _log = new();
    private readonly object _logGate = new();

    private DispatcherTimer? _uiTimer;
    private System.Threading.Timer? _tickTimer;
    private volatile bool _streaming;
    private long _framesSent;
    private long _logVersion;
    private long _renderedLogVersion = -1;
    private string _lastHex = string.Empty;
    private string _lastChecksum = "-";
    private double _lastWeight;
    private string _serverError = string.Empty;
    private bool _ready;

    public MainWindow()
    {
        _settings = SimulatorSettings.Load();
        InitializeComponent();

        ScenarioBox.ItemsSource = ScenarioCatalog.All;
        PortBox.Text = _settings.Port.ToString(CultureInfo.InvariantCulture);
        TargetBox.Text = _settings.TargetKg.ToString("0", CultureInfo.InvariantCulture);
        FpsSlider.Value = Math.Clamp(_settings.Fps, 1, 30);
        MotionToggle.IsChecked = _settings.Motion;
        ScenarioBox.SelectedValue = _settings.Scenario;

        _engine.SetTarget(_settings.TargetKg);
        _engine.SetMotion(_settings.Motion);
        _engine.SetScenario(_settings.Scenario);
        _lastWeight = _settings.TargetKg;

        UpdateScenarioDescription();
        _server.ClientChanged += OnClientChanged;

        _ready = true;
        Loaded += OnLoaded;
        Closing += OnClosing;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        FpsText.Text = $"{(int)Math.Round(FpsSlider.Value)} fps";
        StartServer();
        if (_server.IsListening) StartStreaming();

        _uiTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _uiTimer.Tick += (_, _) => RefreshUi();
        _uiTimer.Start();
        RefreshUi();
    }

    private void StartServer()
    {
        if (!int.TryParse(PortBox.Text.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var port) ||
            port is < 1 or > 65535)
        {
            _serverError = "Invalid port. Use 1-65535.";
            RefreshConnectionUi();
            return;
        }

        try
        {
            _server.Start(port);
            _serverError = string.Empty;
            _settings.Port = port;
        }
        catch (Exception ex)
        {
            _serverError = $"Could not listen on 127.0.0.1:{port}. {ex.Message}";
        }

        RefreshConnectionUi();
    }

    private void StartStreaming()
    {
        _streaming = true;
        RestartTickTimer();
        StreamButton.Content = "Stop stream";
        StreamStateText.Text = "Streaming";
        StreamStateText.Foreground = StableForeground;
    }

    private void StopStreaming()
    {
        _streaming = false;
        _tickTimer?.Dispose();
        _tickTimer = null;
        StreamButton.Content = "Start stream";
        StreamStateText.Text = "Stopped";
        StreamStateText.Foreground = IdleForeground;
    }

    private void RestartTickTimer()
    {
        _tickTimer?.Dispose();
        var fps = Math.Clamp((int)Math.Round(FpsSlider.Value), 1, 30);
        var period = Math.Max(10, 1000 / fps);
        _tickTimer = new System.Threading.Timer(
            OnTick, null, TimeSpan.Zero, TimeSpan.FromMilliseconds(period));
    }

    private void OnTick(object? state)
    {
        if (!_streaming) return;

        try
        {
            foreach (var frame in _engine.Tick(DateTimeOffset.Now))
            {
                var bytes = frame.Kind switch
                {
                    SimulatorFrameKind.CorruptWeight =>
                        Xk3190FrameEncoder.Build(frame.WeightKg, 0, corruptChecksum: true),
                    SimulatorFrameKind.Garbage or SimulatorFrameKind.OtherFormat =>
                        frame.RawBytes ?? [],
                    _ => Xk3190FrameEncoder.Build(frame.WeightKg, 0),
                };

                if (bytes.Length == 0) continue;

                var sent = _server.Send(bytes);
                _lastHex = Xk3190FrameDecoder.HexDump(bytes);
                _lastWeight = frame.WeightKg;
                _lastChecksum = frame.Kind switch
                {
                    SimulatorFrameKind.CorruptWeight => "BAD (injected)",
                    SimulatorFrameKind.Garbage or SimulatorFrameKind.OtherFormat => "n/a",
                    _ => "OK",
                };

                if (sent) Interlocked.Increment(ref _framesSent);
                AppendLog(frame.WeightKg, _lastHex);
            }
        }
        catch
        {
            // A simulation fault must never take the stream thread down.
        }
    }

    private void AppendLog(double weightKg, string hex)
    {
        var line = $"{DateTime.Now:HH:mm:ss.fff}  {weightKg,9:0} kg  {hex}";
        lock (_logGate)
        {
            _log.AppendLine(line);
            if (_log.Length > 24_000) _log.Remove(0, 6_000);
            _logVersion++;
        }
    }

    private void RefreshUi()
    {
        var snapshot = _engine.Snapshot();

        WeightText.Text = _lastWeight.ToString("N0", CultureInfo.InvariantCulture);
        FrameHexText.Text = _lastHex;
        ChecksumText.Text = $"Last checksum: {_lastChecksum}";
        FramesText.Text = $"{Interlocked.Read(ref _framesSent):N0} frames sent";

        if (snapshot.Motion)
        {
            StateText.Text = "MOTION";
            StateBadge.Background = MotionBackground;
            StateText.Foreground = MotionForeground;
        }
        else
        {
            StateText.Text = "STABLE";
            StateBadge.Background = StableBackground;
            StateText.Foreground = StableForeground;
        }

        RefreshConnectionUi();

        var version = Interlocked.Read(ref _logVersion);
        if (version != _renderedLogVersion)
        {
            string text;
            lock (_logGate) text = _log.ToString();
            LogBox.Text = text;
            LogBox.ScrollToEnd();
            _renderedLogVersion = version;
        }
    }

    private void RefreshConnectionUi()
    {
        if (!_ready) return;

        var listening = _server.IsListening;
        var hasClient = _server.HasClient;

        ServerStatusText.Text = listening
            ? $"Listening on 127.0.0.1:{_settings.Port}"
            : string.IsNullOrEmpty(_serverError)
                ? "Server stopped."
                : _serverError;

        ClientStatusText.Text = hasClient
            ? $"Augment Scale connected: {_server.ClientEndpoint}"
            : "Waiting for the Augment Scale app...";
        ClientStatusText.Foreground = hasClient ? StableForeground : MotionForeground;
    }

    private void UpdateScenarioDescription()
    {
        ScenarioDescriptionText.Text = ScenarioBox.SelectedItem is ScenarioOption option
            ? option.Description
            : string.Empty;
    }

    private bool TryReadTarget(out double target)
    {
        target = 0;
        var text = TargetBox.Text.Trim();
        if (double.TryParse(text, NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.InvariantCulture, out target) && double.IsFinite(target))
        {
            target = Math.Clamp(target, -999_995, 999_995);
            return true;
        }

        MessageBox.Show(
            "Enter a numeric weight in kg, for example 12800 or 12,800.",
            "Invalid weight",
            MessageBoxButton.OK,
            MessageBoxImage.Warning);
        return false;
    }

    private void ApplyTarget(double target)
    {
        _engine.SetTarget(target);
        _settings.TargetKg = target;
        TargetBox.Text = target.ToString("0", CultureInfo.InvariantCulture);
    }

    private void ApplyTarget_Click(object sender, RoutedEventArgs e)
    {
        if (TryReadTarget(out var target)) ApplyTarget(target);
    }

    private void Zero_Click(object sender, RoutedEventArgs e) => ApplyTarget(0);

    private void Preset_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string tag } &&
            double.TryParse(tag, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
        {
            ApplyTarget(value);
        }
    }

    private void Nudge_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string tag } &&
            double.TryParse(tag, NumberStyles.Float, CultureInfo.InvariantCulture, out var delta))
        {
            _engine.Nudge(delta);
            var target = _engine.Snapshot().TargetKg;
            _settings.TargetKg = target;
            TargetBox.Text = target.ToString("0", CultureInfo.InvariantCulture);
        }
    }

    private void MotionToggle_Changed(object sender, RoutedEventArgs e)
    {
        if (!_ready) return;
        _settings.Motion = MotionToggle.IsChecked == true;
        _engine.SetMotion(_settings.Motion);
    }

    private void ScenarioBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_ready || ScenarioBox.SelectedItem is not ScenarioOption option) return;
        _settings.Scenario = option.Value;
        _engine.SetScenario(option.Value);
        UpdateScenarioDescription();
    }

    private void StreamButton_Click(object sender, RoutedEventArgs e)
    {
        if (_streaming)
        {
            StopStreaming();
            return;
        }

        if (!_server.IsListening) StartServer();
        StartStreaming();
    }

    private void FpsSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (!_ready) return;
        _settings.Fps = Math.Clamp((int)Math.Round(e.NewValue), 1, 30);
        FpsText.Text = $"{_settings.Fps} fps";
        if (_streaming) RestartTickTimer();
    }

    private void RestartServer_Click(object sender, RoutedEventArgs e)
    {
        StopStreaming();
        _server.Stop();
        StartServer();
        if (_server.IsListening) StartStreaming();
    }

    private void DisconnectClient_Click(object sender, RoutedEventArgs e)
    {
        _server.DisconnectClient();
        RefreshConnectionUi();
    }

    private void OnClientChanged(bool connected, string endpoint)
    {
        Dispatcher.BeginInvoke(new Action(RefreshConnectionUi));
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        _settings.Port = int.TryParse(PortBox.Text.Trim(), out var port) ? port : _settings.Port;
        _settings.Fps = Math.Clamp((int)Math.Round(FpsSlider.Value), 1, 30);
        _settings.Motion = MotionToggle.IsChecked == true;
        if (ScenarioBox.SelectedItem is ScenarioOption option) _settings.Scenario = option.Value;
        if (TryReadTargetQuiet(out var target)) _settings.TargetKg = target;
        _settings.Save();

        StopStreaming();
        _uiTimer?.Stop();
        _server.Dispose();
    }

    private bool TryReadTargetQuiet(out double target)
    {
        return double.TryParse(
            TargetBox.Text.Trim(),
            NumberStyles.Float | NumberStyles.AllowThousands,
            CultureInfo.InvariantCulture,
            out target);
    }
}
