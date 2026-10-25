using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using AugmentScale.Models;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace AugmentScale.Services;

/// <summary>
/// Prints archive reports with an offscreen WebView2 that shares the main
/// window's browser environment. Rendering is serialized because one hidden
/// window is reused for every archive run.
/// </summary>
public sealed class WebViewPdfArchiveRenderer : IPdfArchiveRenderer, IDisposable
{
    private const string VirtualHost = "scale.augmentlab.net";
    private static readonly TimeSpan PageReadyTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan RenderTimeout = TimeSpan.FromSeconds(60);
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly Func<Task<CoreWebView2Environment>> _environmentProvider;
    private readonly string _webUiFolder;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private Window? _window;
    private WebView2? _webView;
    private CoreWebView2Environment? _environment;
    private bool _disposed;

    public WebViewPdfArchiveRenderer(
        Func<Task<CoreWebView2Environment>> environmentProvider,
        string webUiFolder)
    {
        _environmentProvider = environmentProvider;
        _webUiFolder = webUiFolder;
    }

    public async Task RenderAsync(HistoryReportDto report, string outputPath,
        CancellationToken cancellationToken)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(WebViewPdfArchiveRenderer));

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var dispatcher = Application.Current?.Dispatcher
                ?? throw new InvalidOperationException("The archive renderer needs the WPF application.");
            var operation = dispatcher.InvokeAsync<Task>(
                () => RenderOnUiAsync(report, outputPath, cancellationToken));
            await operation.Task.Unwrap().WaitAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task RenderOnUiAsync(HistoryReportDto report, string outputPath,
        CancellationToken cancellationToken)
    {
        await EnsureReadyAsync(cancellationToken);
        var core = _webView!.CoreWebView2
            ?? throw new InvalidOperationException("The archive browser is not ready.");

        await NavigateAsync(core, $"https://{VirtualHost}/archive-report.html", cancellationToken);
        await WaitForFunctionAsync(core, "typeof window.renderArchiveReport === 'function'",
            PageReadyTimeout, cancellationToken);

        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            try
            {
                using var document = JsonDocument.Parse(args.WebMessageAsJson);
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object ||
                    !root.TryGetProperty("type", out var type)) return;

                if (string.Equals(type.GetString(), "archiveReady", StringComparison.Ordinal))
                {
                    ready.TrySetResult();
                }
                else if (string.Equals(type.GetString(), "archiveError", StringComparison.Ordinal))
                {
                    var message = root.TryGetProperty("message", out var value)
                        ? value.GetString()
                        : null;
                    ready.TrySetException(new InvalidOperationException(
                        message ?? "The archive page could not build the report."));
                }
            }
            catch (JsonException)
            {
                // Ignore unrelated or malformed messages.
            }
        }

        core.WebMessageReceived += OnMessage;
        try
        {
            var json = JsonSerializer.Serialize(report, Json);
            await core.ExecuteScriptAsync($"window.renderArchiveReport({json});");
            await ready.Task.WaitAsync(RenderTimeout, cancellationToken);
        }
        finally
        {
            core.WebMessageReceived -= OnMessage;
        }

        var settings = _environment!.CreatePrintSettings();
        settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
        settings.PageWidth = 8.27;
        settings.PageHeight = 11.69;
        settings.Orientation = CoreWebView2PrintOrientation.Portrait;
        settings.ShouldPrintBackgrounds = true;
        settings.ShouldPrintHeaderAndFooter = false;
        settings.ShouldPrintSelectionOnly = false;
        settings.ScaleFactor = 1.0;
        settings.MarginTop = 0.3937008;
        settings.MarginBottom = 0.3937008;
        settings.MarginLeft = 0.3937008;
        settings.MarginRight = 0.3937008;

        if (!await core.PrintToPdfAsync(outputPath, settings))
            throw new InvalidOperationException("WebView2 could not create the archive PDF.");
    }

    private async Task EnsureReadyAsync(CancellationToken cancellationToken)
    {
        if (_webView?.CoreWebView2 is not null) return;

        DisposeWindow();

        if (!File.Exists(Path.Combine(_webUiFolder, "archive-report.html")))
            throw new InvalidOperationException(
                $"Archive UI assets were not found at {_webUiFolder}.");

        try
        {
            _environment = await _environmentProvider().WaitAsync(cancellationToken);

            _webView = new WebView2
            {
                DefaultBackgroundColor = System.Drawing.Color.White,
            };
            _window = new Window
            {
                Title = "Augment Scale archive renderer",
                Width = 820,
                Height = 1160,
                Left = -10000,
                Top = -10000,
                ShowInTaskbar = false,
                ShowActivated = false,
                WindowStyle = WindowStyle.ToolWindow,
                ResizeMode = ResizeMode.NoResize,
                WindowStartupLocation = WindowStartupLocation.Manual,
                Content = _webView,
            };

            _window.Show();
            await _webView.EnsureCoreWebView2Async(_environment);

            var core = _webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDefaultScriptDialogsEnabled = false;
            core.Settings.IsWebMessageEnabled = true;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;

            core.SetVirtualHostNameToFolderMapping(
                VirtualHost, _webUiFolder, CoreWebView2HostResourceAccessKind.DenyCors);
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.NewWindowRequested += (_, args) => args.Handled = true;
        }
        catch
        {
            DisposeWindow();
            throw;
        }
    }

    private static async Task NavigateAsync(CoreWebView2 core, string url,
        CancellationToken cancellationToken)
    {
        var completed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
        {
            if (args.IsSuccess) completed.TrySetResult();
            else completed.TrySetException(new InvalidOperationException(
                $"The archive page failed to load ({args.WebErrorStatus})."));
        }

        core.NavigationCompleted += OnCompleted;
        try
        {
            core.Navigate(url);
            await completed.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
        }
        finally
        {
            core.NavigationCompleted -= OnCompleted;
        }
    }

    private static async Task WaitForFunctionAsync(CoreWebView2 core, string expression,
        TimeSpan timeout, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            var result = await core.ExecuteScriptAsync(expression);
            if (string.Equals(result, "true", StringComparison.OrdinalIgnoreCase)) return;
            await Task.Delay(50, cancellationToken);
        }

        throw new InvalidOperationException("The archive page did not become ready.");
    }

    private void DisposeWindow()
    {
        try { _window?.Close(); } catch { /* shutdown */ }
        try { _webView?.Dispose(); } catch { /* shutdown */ }
        _window = null;
        _webView = null;
        _environment = null;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null) return;
        if (dispatcher.CheckAccess()) DisposeWindow();
        else dispatcher.Invoke(DisposeWindow, DispatcherPriority.Send);
    }
}
