using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using AugmentScale.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace AugmentScale;

public partial class MainWindow : Window
{
    private const string VirtualHost = "app.augmentscale.local";

    private readonly ConfigService _config;
    private readonly DatabaseService _database;
    private readonly ScaleReaderService _scale;
    private readonly BridgeService _bridge;
    private readonly TaskCompletionSource<CoreWebView2Environment> _environmentReady =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _fullscreen;
    private WindowState _previousState;
    private WindowStyle _previousStyle;
    private ResizeMode _previousResizeMode;
    private bool _started;
    private bool _overlayHidden;
    private bool _fatalShown;

    public MainWindow(
        ConfigService config,
        DatabaseService database,
        ScaleReaderService scale,
        BridgeService bridge)
    {
        _config = config;
        _database = database;
        _scale = scale;
        _bridge = bridge;
        InitializeComponent();

        var work = SystemParameters.WorkArea;
        if (Width > work.Width) Width = work.Width;
        if (Height > work.Height) Height = work.Height;

        Title = _config.IsDefaultDataDirectory
            ? "Augment Scale"
            : "Augment Scale — TEST DATA";
        _bridge.UiReady += OnUiReady;
        Loaded += OnLoaded;
        Activated += OnActivated;
        Closing += OnClosing;
    }

    public Task<CoreWebView2Environment> EnvironmentReady => _environmentReady.Task;

    private void OnUiReady()
    {
        // Raised on the UI thread by BridgeService when the interface reports
        // its first interactive frame; schedule the collapse for safety.
        Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(CollapseLoadingOverlay));
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            LoadingText.Text = "Checking the WebView2 runtime...";
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            AppLog.Info($"WebView2 runtime {version}");

            var webUi = Path.Combine(AppContext.BaseDirectory, "WebUI");
            if (!File.Exists(Path.Combine(webUi, "index.html")))
                throw new InvalidOperationException($"WebUI assets were not found at {webUi}.");

            Directory.CreateDirectory(_config.WebViewDataDirectory);
            LoadingText.Text = "Loading workstation interface...";

            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: _config.WebViewDataDirectory);
            await WebView.EnsureCoreWebView2Async(environment);
            _environmentReady.TrySetResult(environment);

            var core = WebView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = true;
            core.Settings.IsWebMessageEnabled = true;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;

            core.SetVirtualHostNameToFolderMapping(
                VirtualHost, webUi, CoreWebView2HostResourceAccessKind.DenyCors);

            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.ProcessFailed += OnProcessFailed;
            WebView.NavigationCompleted += OnNavigationCompleted;

            _bridge.Attach(core);
            core.Navigate($"https://{VirtualHost}/index.html");
        }
        catch (Exception ex) when (ex is WebView2RuntimeNotFoundException or InvalidOperationException)
        {
            _environmentReady.TrySetException(ex);
            AppLog.Error("WebView2 initialization failed", ex);
            ShowFatal(
                "Microsoft Edge WebView2 Runtime is required.\n\n" +
                "Install the Evergreen WebView2 Runtime from Microsoft, then restart Augment Scale.\n\n" +
                ex.Message);
        }
        catch (Exception ex)
        {
            _environmentReady.TrySetException(ex);
            AppLog.Error("Window initialization failed", ex);
            ShowFatal($"Augment Scale could not load its interface.\n\n{ex.Message}");
        }
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            AppLog.Error($"Navigation failed: {e.WebErrorStatus}");
            ShowFatal($"The workstation interface failed to load ({e.WebErrorStatus}).");
            return;
        }

        // The web UI hides this overlay itself once the login screen is rendered
        // (ui-ready). Keep a fallback so a failed bootstrap still surfaces.
        StartOverlayFallback();
        FocusWebViewDeferred();
        if (_started) return;
        _started = true;
        _scale.Start();
        AppLog.Info("Scale reader started");
    }

    private void StartOverlayFallback()
    {
        _ = Task.Delay(TimeSpan.FromSeconds(3)).ContinueWith(
            _ => Dispatcher.BeginInvoke(new Action(CollapseLoadingOverlay)));
    }

    private void CollapseLoadingOverlay()
    {
        if (_fatalShown) return;
        if (_overlayHidden)
        {
            FocusWebViewDeferred();
            return;
        }
        _overlayHidden = true;
        LoadingOverlay.Visibility = Visibility.Collapsed;
        AppLog.Info("Workstation interface ready");
        FocusWebViewDeferred();
    }

    private void OnActivated(object? sender, EventArgs e) => FocusWebViewDeferred();

    private void FocusWebViewDeferred()
    {
        Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(FocusWebView));
    }

    private void FocusWebView()
    {
        if (!IsActive || !_overlayHidden) return;
        WebView.Focus();
        Keyboard.Focus(WebView);
    }

    private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        AppLog.Error($"WebView2 process failed: {e.ProcessFailedKind}");
        Dispatcher.Invoke(() =>
            ShowFatal("The interface process stopped unexpectedly. Restart Augment Scale."));
    }

    private void ShowFatal(string message)
    {
        _fatalShown = true;
        _overlayHidden = false;
        LoadingOverlay.Visibility = Visibility.Visible;
        LoadingText.Text = message;
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F11)
        {
            ToggleFullscreen();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.D &&
            Keyboard.Modifiers.HasFlag(ModifierKeys.Control) &&
            Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
        {
            try { WebView.CoreWebView2?.OpenDevToolsWindow(); } catch { /* not ready */ }
            e.Handled = true;
        }
    }

    private void ToggleFullscreen()
    {
        if (!_fullscreen)
        {
            _previousState = WindowState;
            _previousStyle = WindowStyle;
            _previousResizeMode = ResizeMode;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Normal;
            WindowState = WindowState.Maximized;
            _fullscreen = true;
        }
        else
        {
            WindowStyle = _previousStyle;
            ResizeMode = _previousResizeMode;
            WindowState = _previousState;
            _fullscreen = false;
        }
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        _environmentReady.TrySetCanceled();
        try { _scale.Stop(); } catch { /* app exit */ }
        try { WebView.Dispose(); } catch { /* app exit */ }
    }
}
