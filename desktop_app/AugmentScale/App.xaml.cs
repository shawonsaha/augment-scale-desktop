using System.Threading;
using System.Windows;
using System.Windows.Threading;
using AugmentScale.Services;

namespace AugmentScale;

public partial class App : Application
{
    private Mutex? _singleInstance;
    private ConfigService? _config;
    private ScaleReaderService? _scale;
    private DatabaseService? _database;
    private PrintService? _print;
    private BridgeService? _bridge;

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

        try
        {
            _config = new ConfigService();
            _config.EnsureInitialized();
            AppLog.Initialize(_config.LogDirectory);
            AppLog.Info("Starting Augment Scale 1.0.0");

            _database = new DatabaseService(_config);
            _database.EnsureInitialized();
            _scale = new ScaleReaderService(_config, _database);
            _print = new PrintService(_database);
            _bridge = new BridgeService(_database, _scale, _print);

            var window = new MainWindow(_config, _database, _scale, _bridge);
            MainWindow = window;
            window.Show();
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
}
