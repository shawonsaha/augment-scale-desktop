using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using AugmentScale.Services;
using Microsoft.Web.WebView2.Core;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Wpf;

namespace AugmentScale;

public partial class MainWindow : Window
{
    private const string VirtualHost = "scale.augmentlab.net";

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

        try
        {
            var uri = new Uri("pack://application:,,,/AugmentScale;component/Resources/app.ico");
            Icon = BitmapFrame.Create(uri);
        }
        catch
        {
            // Best effort; XAML declaration and Win32 fallback handle this.
        }

        _bridge.UiReady += OnUiReady;
        _bridge.ThemeChanged += OnThemeChanged;
        SourceInitialized += OnSourceInitialized;
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
#if DEBUG
            core.Settings.AreDevToolsEnabled = true;
#else
            core.Settings.AreDevToolsEnabled = false;
#endif
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

#if DEBUG
        if (e.Key == Key.D &&
            Keyboard.Modifiers.HasFlag(ModifierKeys.Control) &&
            Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
        {
            try { WebView.CoreWebView2?.OpenDevToolsWindow(); } catch { /* not ready */ }
            e.Handled = true;
        }
#endif
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
    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        // Paint dark title bar immediately at window creation so the #0B1220 splash never flashes white
        ApplyTitleBarTheme(isDark: true);
        ApplyWindowIcons(hwnd);
    }

    private void OnThemeChanged(string theme)
    {
        var isDark = string.Equals(theme, "dark", StringComparison.OrdinalIgnoreCase);
        Dispatcher.BeginInvoke(DispatcherPriority.Normal, () => ApplyTitleBarTheme(isDark));
    }

    private void ApplyTitleBarTheme(bool isDark)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;

        try
        {
            int useDarkMode = isDark ? 1 : 0;
            var hrDark = DwmApi.DwmSetWindowAttribute(hwnd, DwmApi.DWMWA_USE_IMMERSIVE_DARK_MODE, ref useDarkMode, sizeof(int));
            if (hrDark != 0)
            {
                hrDark = DwmApi.DwmSetWindowAttribute(hwnd, DwmApi.DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref useDarkMode, sizeof(int));
            }
            AppLog.Info($"Dwm dark mode (isDark={isDark}) HRESULT=0x{hrDark:X8}");

            if (Environment.OSVersion.Version.Build >= 22000)
            {
                // #0B1220 in COLORREF format (0x00BBGGRR): R=0x0B, G=0x12, B=0x20 => 0x0020120B
                int captionColor = isDark ? 0x0020120B : DwmApi.DWMWA_COLOR_DEFAULT;
                int textColor = isDark ? 0x00FFFFFF : DwmApi.DWMWA_COLOR_DEFAULT;
                var hrCap = DwmApi.DwmSetWindowAttribute(hwnd, DwmApi.DWMWA_CAPTION_COLOR, ref captionColor, sizeof(int));
                var hrTxt = DwmApi.DwmSetWindowAttribute(hwnd, DwmApi.DWMWA_TEXT_COLOR, ref textColor, sizeof(int));
                AppLog.Info($"Dwm caption color HRESULT=0x{hrCap:X8}, text color HRESULT=0x{hrTxt:X8}");
            }
        }
        catch (Exception ex)
        {
            AppLog.Info($"Could not update window title bar theme: {ex.Message}");
        }
    }

    private static class DwmApi
    {
        public const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
        public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        public const int DWMWA_CAPTION_COLOR = 35;
        public const int DWMWA_TEXT_COLOR = 36;
        public const int DWMWA_COLOR_DEFAULT = unchecked((int)0xFFFFFFFF);

        [DllImport("dwmapi.dll", PreserveSig = true)]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
    }
    private void ApplyWindowIcons(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        try
        {
            var iconCandidates = new[]
            {
                Path.Combine(AppContext.BaseDirectory, "Resources", "app.ico"),
                Path.Combine(AppContext.BaseDirectory, "app.ico")
            };

            var iconPath = iconCandidates.FirstOrDefault(File.Exists);
            IntPtr hBig = IntPtr.Zero;
            IntPtr hSmall = IntPtr.Zero;

            if (iconPath is not null)
            {
                hBig = NativeMethods.LoadImage(IntPtr.Zero, iconPath, NativeMethods.IMAGE_ICON, 32, 32, NativeMethods.LR_LOADFROMFILE);
                hSmall = NativeMethods.LoadImage(IntPtr.Zero, iconPath, NativeMethods.IMAGE_ICON, 16, 16, NativeMethods.LR_LOADFROMFILE);
            }

            if (hBig == IntPtr.Zero || hSmall == IntPtr.Zero)
            {
                var exePath = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
                if (!string.IsNullOrEmpty(exePath))
                {
                    NativeMethods.ExtractIconEx(exePath, 0, out var extBig, out var extSmall, 1);
                    if (hBig == IntPtr.Zero) hBig = extBig;
                    if (hSmall == IntPtr.Zero) hSmall = extSmall;
                }
            }

            if (hBig != IntPtr.Zero)
            {
                NativeMethods.SendMessage(hwnd, NativeMethods.WM_SETICON, (IntPtr)NativeMethods.ICON_BIG, hBig);
                NativeMethods.SetClassLongPtr(hwnd, NativeMethods.GCLP_HICON, hBig);
                AppLog.Info($"Applied Win32 ICON_BIG (32x32) 0x{hBig:X8} to HWND 0x{hwnd:X8}");
            }

            if (hSmall != IntPtr.Zero)
            {
                NativeMethods.SendMessage(hwnd, NativeMethods.WM_SETICON, (IntPtr)NativeMethods.ICON_SMALL, hSmall);
                NativeMethods.SetClassLongPtr(hwnd, NativeMethods.GCLP_HICONSM, hSmall);
                AppLog.Info($"Applied Win32 ICON_SMALL (16x16) 0x{hSmall:X8} to HWND 0x{hwnd:X8}");
            }
        }
        catch (Exception ex)
        {
            AppLog.Info($"Could not apply Win32 window icons: {ex.Message}");
        }
    }

    private static class NativeMethods
    {
        public const uint WM_SETICON = 0x0080;
        public const int ICON_SMALL = 0;
        public const int ICON_BIG = 1;
        public const uint IMAGE_ICON = 1;
        public const uint LR_LOADFROMFILE = 0x00000010;
        public const int GCLP_HICON = -14;
        public const int GCLP_HICONSM = -34;

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern IntPtr LoadImage(IntPtr hinst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("shell32.dll", CharSet = CharSet.Auto)]
        public static extern uint ExtractIconEx(string szFileName, int nIconIndex, out IntPtr phiconLarge, out IntPtr phiconSmall, uint nIcons);

        [DllImport("user32.dll", EntryPoint = "SetClassLongPtr")]
        public static extern IntPtr SetClassLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        [DllImport("user32.dll", EntryPoint = "SetClassLong")]
        public static extern IntPtr SetClassLong32(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        public static IntPtr SetClassLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) =>
            IntPtr.Size == 8 ? SetClassLongPtr64(hWnd, nIndex, dwNewLong) : SetClassLong32(hWnd, nIndex, dwNewLong);
    }
}
