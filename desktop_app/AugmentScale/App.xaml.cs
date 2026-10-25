using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using AugmentScale.Services;

namespace AugmentScale;

public partial class App : Application
{
    private Mutex? _singleInstance;
    private ConfigService? _config;
    private ScaleReaderService? _scale;
    private DatabaseService? _database;
    private BridgeService? _bridge;
    private PdfArchiveService? _archive;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _singleInstance = new Mutex(true, @"Local\AugmentScale.SingleInstance", out var isFirst);
        if (!isFirst)
        {
            MessageBox.Show(
                "Augment Scale is already running on this workstation.",
                "Augment Scale",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            AppLog.Error("Unhandled domain exception", args.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            AppLog.Error("Unobserved task exception", args.Exception);
            args.SetObserved();
        };

        if (e.Args.Length > 0 &&
            string.Equals(e.Args[0], "--reset-pin", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                ResetPin(e.Args.Length > 1 ? e.Args[1] : null);
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "Reset PIN", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            Shutdown();
            return;
        }

        try
        {
            _config = new ConfigService();
            _config.EnsureInitialized();
            AppLog.Initialize(_config.LogDirectory);
            AppLog.Info("Starting Augment Scale 1.0.0");

            // Constructors are cheap; heavy work happens after Show.
            _database = new DatabaseService(_config);
            _scale = new ScaleReaderService(_config, _database);
            _bridge = new BridgeService(_database, _scale);

            var window = new MainWindow(_config, _database, _scale, _bridge);
            MainWindow = window;

            _archive = new PdfArchiveService(
                _database,
                new WebViewPdfArchiveRenderer(
                    () => window.EnvironmentReady,
                    Path.Combine(AppContext.BaseDirectory, "WebUI")),
                _config);
            _bridge.Archive = _archive;

            window.Show();

            // Show the window first so the splash mask paints immediately, then
            // initialize the database while WebView2 spins up in the background.
            _database.EnsureInitialized();
            _archive.Start();
        }
        catch (Exception ex)
        {
            AppLog.Error("Startup failed", ex);
            MessageBox.Show(
                $"Augment Scale could not start.{Environment.NewLine}{Environment.NewLine}{ex.Message}",
                "Augment Scale",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(-1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { _archive?.Dispose(); } catch (Exception ex) { AppLog.Error("Archive shutdown failed", ex); }
        try { _scale?.Dispose(); } catch (Exception ex) { AppLog.Error("Scale shutdown failed", ex); }
        _singleInstance?.ReleaseMutex();
        _singleInstance?.Dispose();
        base.OnExit(e);
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        AppLog.Error("Unhandled UI exception", e.Exception);
        MessageBox.Show(
            $"An unexpected error occurred.{Environment.NewLine}{Environment.NewLine}{e.Exception.Message}",
            "Augment Scale",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
        e.Handled = true;
    }

    private static void ResetPin(string? operatorId)
    {
        var config = new ConfigService();
        var database = new DatabaseService(config);
        var operators = database.GetOperators();

        if (string.IsNullOrWhiteSpace(operatorId))
        {
            var ids = string.Join(", ", operators.Select(op => op.Id));
            MessageBox.Show(
                $"Usage: AugmentScale.exe --reset-pin <operator-id>{Environment.NewLine}{Environment.NewLine}Operators: {ids}",
                "Reset PIN", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var profile = operators.FirstOrDefault(op =>
            string.Equals(op.Id, operatorId, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(op.Code, operatorId, StringComparison.OrdinalIgnoreCase));
        if (profile is null)
        {
            MessageBox.Show($"Operator '{operatorId}' was not found.", "Reset PIN",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var pinBox = new PasswordBox { MaxLength = 4, Margin = new Thickness(0, 8, 0, 0) };
        var confirmBox = new PasswordBox { MaxLength = 4, Margin = new Thickness(0, 8, 0, 0) };
        var resetButton = new Button
        {
            Content = "Reset PIN",
            Padding = new Thickness(12, 6, 12, 6),
            Margin = new Thickness(0, 16, 0, 0),
        };

        var panel = new StackPanel { Margin = new Thickness(20) };
        panel.Children.Add(new TextBlock
        {
            Text = $"Enter a new 4-digit PIN for {profile.Name} ({profile.Id}):",
            TextWrapping = TextWrapping.Wrap,
        });
        panel.Children.Add(pinBox);
        panel.Children.Add(new TextBlock { Text = "Confirm PIN:", Margin = new Thickness(0, 12, 0, 0) });
        panel.Children.Add(confirmBox);
        panel.Children.Add(resetButton);

        var window = new Window
        {
            Title = "Reset operator PIN",
            Content = panel,
            Width = 380,
            SizeToContent = SizeToContent.Height,
            ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
        };

        resetButton.Click += (_, _) =>
        {
            var pin = pinBox.Password;
            if (pin.Length != 4 || !pin.All(char.IsAsciiDigit))
            {
                MessageBox.Show("PIN must be exactly 4 digits.", "Reset PIN",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            if (pin != confirmBox.Password)
            {
                MessageBox.Show("PINs do not match.", "Reset PIN",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                config.SetPin(profile.Id, pin);
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "Reset PIN", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            MessageBox.Show($"PIN for {profile.Name} was updated.", "Reset PIN",
                MessageBoxButton.OK, MessageBoxImage.Information);
            window.Close();
        };

        window.ShowDialog();
    }
}
