using System.IO;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using AugmentScale.Services;
using System.Runtime.InteropServices;
using Velopack;

namespace AugmentScale;

public partial class App : Application
{
    public App()
    {
        VelopackApp.Build().Run();
    }
    private Mutex? _singleInstance;
    private ConfigService? _config;
    private ScaleReaderService? _scale;
    private DatabaseService? _database;
    private BridgeService? _bridge;
    private PdfArchiveService? _archive;
    private CloudControlService? _cloud;
    private UpdateService? _updater;

    [DllImport("shell32.dll", SetLastError = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(
        [MarshalAs(UnmanagedType.LPWStr)] string AppID);

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    protected override void OnStartup(StartupEventArgs e)
    {
        try
        {
            SetCurrentProcessExplicitAppUserModelID("AugmentScale.Workstation.1.0");
            SHChangeNotify(0x08000000 /* SHCNE_ASSOCCHANGED */, 0, IntPtr.Zero, IntPtr.Zero);
        }
        catch
        {
            // Best effort on non-standard Windows shells.
        }

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

            _cloud = new CloudControlService(_database, _config);
            _bridge.Cloud = _cloud;

            _updater = new UpdateService(_config, _scale);
            _bridge.Updater = _updater;
            _cloud.Updater = _updater;

            window.Show();

            // Show the window first so the splash mask paints immediately, then
            // initialize the database while WebView2 spins up in the background.
            _database.EnsureInitialized();
            _archive.Start();
            _cloud.Start();
            _updater.Start();
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
        try { _updater?.Dispose(); } catch (Exception ex) { AppLog.Error("Updater shutdown failed", ex); }
        try { _cloud?.Dispose(); } catch (Exception ex) { AppLog.Error("Cloud shutdown failed", ex); }
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
}
