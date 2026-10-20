using System.Text.Json;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using Microsoft.Web.WebView2.Core;

namespace AugmentScale.Services;

/// <summary>
/// Routes WebView2 postMessage commands to the database and pushes live scale
/// readings into the UI. One instance per window.
/// </summary>
public sealed class BridgeService
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly DatabaseService _database;
    private readonly ScaleReaderService _scale;
    private readonly PrintService _print;
    private readonly object _gate = new();

    private CoreWebView2? _webView;
    private SynchronizationContext? _uiContext;
    private int _weightPushInFlight;
    private int _statusPushInFlight;

    public BridgeService(DatabaseService database, ScaleReaderService scale, PrintService print)
    {
        _database = database;
        _scale = scale;
        _print = print;
    }

    public void Attach(CoreWebView2 webView)
    {
        lock (_gate)
        {
            if (_webView is not null)
            {
                _webView.WebMessageReceived -= OnWebMessageReceived;
            }

            _webView = webView;
            _uiContext = SynchronizationContext.Current;
            _webView.WebMessageReceived += OnWebMessageReceived;
            _scale.ReadingReceived += OnReadingReceived;
            _scale.StatusChanged += OnScaleStatusChanged;
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        _ = HandleMessageAsync(e.WebMessageAsJson);
    }

    private async Task HandleMessageAsync(string json)
    {
        CommandEnvelope? envelope = null;
        try
        {
            envelope = JsonSerializer.Deserialize<CommandEnvelope>(json, Json);
            if (envelope is null || string.IsNullOrWhiteSpace(envelope.Command))
                return;
            if (string.IsNullOrWhiteSpace(envelope.RequestId))
                envelope.RequestId = Guid.NewGuid().ToString("N");

            var data = await DispatchAsync(envelope.Command, envelope.Payload);
            Respond(CommandResponse.Ok(envelope.RequestId, data));
        }
        catch (Exception ex)
        {
            Respond(CommandResponse.Fail(
                envelope?.RequestId ?? Guid.NewGuid().ToString("N"),
                ex.Message));
        }
    }

    private async Task<object?> DispatchAsync(string command, JsonElement payload)
    {
        switch (command)
        {
            case "getOperators":
                return _database.GetOperators();

            case "authenticatePin":
            {
                var request = Deserialize<PinAuthRequest>(payload);
                return _database.AuthenticateOperator(request.OperatorId, request.Pin);
            }

            case "getVehicles":
                return _database.GetVehicles();

            case "getPendingTickets":
                return _database.GetPendingTickets();

            case "getHistory":
            {
                var request = Deserialize<HistoryQueryRequest>(payload);
                return _database.GetHistory(request.Limit, request.Status);
            }

            case "getTicket":
            {
                var request = Deserialize<TicketIdRequest>(payload);
                return _database.GetTicket(request.TicketId);
            }

            case "getNextTicketNumber":
                return _database.PeekNextTicketNumber();

            case "getSyncStatus":
                return _database.GetSyncStatus();

            case "getScaleStatus":
                return new
                {
                    isConnected = _scale.IsConnected,
                    isSimulator = _scale.IsSimulator,
                    portName = _scale.PortName,
                    message = _scale.StatusMessage,
                    hasReading = _scale.LastReading is not null,
                };

            case "createTicket":
            {
                var request = Deserialize<CreateTicketRequest>(payload);
                AttachReading(request.WeightKg, reading => request.Reading = reading);
                return _database.CreateTicket(request);
            }

            case "completeTicket":
            {
                var request = Deserialize<CompleteTicketRequest>(payload);
                AttachReading(request.WeightKg, reading => request.Reading = reading);
                return _database.CompleteTicket(request);
            }

            case "voidTicket":
                return _database.VoidTicket(Deserialize<TicketReasonRequest>(payload));

            case "deleteTicket":
                return _database.SoftDeleteTicket(Deserialize<TicketReasonRequest>(payload));

            case "registerVehicle":
                return _database.RegisterVehicle(Deserialize<VehicleRequest>(payload));

            case "archiveVehicle":
            {
                var request = Deserialize<ArchiveVehicleRequest>(payload);
                var result = _database.ArchiveVehicle(request);
                if (!result.Ok) throw new InvalidOperationException(result.Error ?? "Archive failed.");
                return result.Vehicle;
            }

            case "restoreVehicle":
            {
                var request = Deserialize<ArchiveVehicleRequest>(payload);
                return _database.RestoreVehicle(request)
                       ?? throw new InvalidOperationException("Vehicle not found.");
            }

            case "recordReprint":
            {
                var request = Deserialize<ReprintRequest>(payload);
                var result = _database.RecordReprint(request);
                return new { ticket = result.Ticket, copyNumber = result.CopyNumber };
            }

            case "recordPrint":
            {
                var request = Deserialize<ReprintRequest>(payload);
                var job = _database.RecordPrintJob(request.TicketId, request.DocumentType,
                    request.OperatorId, request.OperatorName, request.Reason);
                return job;
            }

            default:
                throw new InvalidOperationException($"Unknown command '{command}'.");
        }
    }

    private void AttachReading(double weight, Action<WeightReading> assign)
    {
        var reading = _scale.LastReading;
        if (reading is null) return;
        if (DateTimeOffset.Now - reading.CapturedAt > TimeSpan.FromSeconds(30)) return;
        if (Math.Abs(reading.WeightKg - weight) > 1.0) return;
        assign(reading);
    }

    private static T Deserialize<T>(JsonElement payload) where T : new()
    {
        if (payload.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            return new T();
        return payload.Deserialize<T>(Json) ?? new T();
    }

    private void Respond(CommandResponse response)
    {
        var json = JsonSerializer.Serialize(response, Json);
        RunOnUi(() =>
        {
            try { _webView?.PostWebMessageAsJson(json); }
            catch (ObjectDisposedException) { /* window closing */ }
        });
    }

    private void OnReadingReceived(object? sender, WeightReading reading)
    {
        if (Interlocked.CompareExchange(ref _weightPushInFlight, 1, 0) != 0) return;
        var json = JsonSerializer.Serialize(new
        {
            weight = reading.WeightKg,
            isStable = reading.IsStable,
            variance = reading.StabilityVariance,
            isConnected = true,
            source = reading.Source,
            capturedAt = reading.CapturedAt.ToString("O"),
        }, Json);

        RunOnUi(() =>
        {
            var script = $"window.ScaleApp && window.ScaleApp.onWeightData({json});";
            _webView?.ExecuteScriptAsync(script).ContinueWith(_ =>
                Interlocked.Exchange(ref _weightPushInFlight, 0));
        });
    }

    private void OnScaleStatusChanged(object? sender, ScaleConnectionStatus status)
    {
        if (Interlocked.CompareExchange(ref _statusPushInFlight, 1, 0) != 0) return;
        var json = JsonSerializer.Serialize(new
        {
            isConnected = status.Connected,
            isSimulator = status.IsSimulator,
            portName = status.PortName,
            message = status.Message,
        }, Json);

        RunOnUi(() =>
        {
            var script = $"window.ScaleApp && window.ScaleApp.onScaleStatus && window.ScaleApp.onScaleStatus({json});";
            _webView?.ExecuteScriptAsync(script).ContinueWith(_ =>
                Interlocked.Exchange(ref _statusPushInFlight, 0));
        });
    }

    private void RunOnUi(Action action)
    {
        var context = _uiContext;
        if (context is null || SynchronizationContext.Current == context)
        {
            action();
            return;
        }
        context.Post(_ => action(), null);
    }
}

public sealed class PinAuthRequest
{
    public string OperatorId { get; set; } = string.Empty;
    public string Pin { get; set; } = string.Empty;
}

public sealed class TicketIdRequest
{
    public long TicketId { get; set; }
}
