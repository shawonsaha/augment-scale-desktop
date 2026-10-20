using System.Net;
using System.Net.Sockets;

namespace AugmentScale.ScaleSimulator.Networking;

public sealed class TcpFrameServer : IDisposable
{
    private readonly object _gate = new();
    private TcpListener? _listener;
    private TcpClient? _client;
    private NetworkStream? _stream;
    private CancellationTokenSource? _cts;
    private Task? _acceptLoop;

    public event Action<bool, string>? ClientChanged;

    public bool IsListening { get; private set; }

    public bool HasClient
    {
        get
        {
            lock (_gate) return _stream is not null;
        }
    }

    public string ClientEndpoint { get; private set; } = string.Empty;

    public void Start(int port)
    {
        Stop();

        var listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();

        CancellationToken token;
        lock (_gate)
        {
            _listener = listener;
            _cts = new CancellationTokenSource();
            IsListening = true;
            token = _cts.Token;
        }

        _acceptLoop = Task.Run(() => AcceptLoopAsync(listener, token));
    }

    public bool Send(ReadOnlySpan<byte> frame)
    {
        var dropped = false;
        var endpoint = string.Empty;
        lock (_gate)
        {
            if (_stream is null) return false;
            try
            {
                _stream.Write(frame);
                return true;
            }
            catch
            {
                dropped = true;
                endpoint = ClientEndpoint;
                CloseClientLocked();
            }
        }

        if (dropped) ClientChanged?.Invoke(false, endpoint);
        return false;
    }

    public void DisconnectClient()
    {
        string endpoint;
        lock (_gate)
        {
            endpoint = ClientEndpoint;
            CloseClientLocked();
        }
        ClientChanged?.Invoke(false, endpoint);
    }

    public void Stop()
    {
        CancellationTokenSource? cts;
        TcpListener? listener;
        Task? loop;

        lock (_gate)
        {
            cts = _cts;
            listener = _listener;
            loop = _acceptLoop;
            _cts = null;
            _listener = null;
            _acceptLoop = null;
            IsListening = false;
            CloseClientLocked();
        }

        try { cts?.Cancel(); } catch { /* shutting down */ }
        try { listener?.Stop(); } catch { /* shutting down */ }
        try { loop?.Wait(TimeSpan.FromMilliseconds(500)); } catch { /* shutting down */ }
        try { cts?.Dispose(); } catch { /* shutting down */ }
    }

    private async Task AcceptLoopAsync(TcpListener listener, CancellationToken token)
    {
        try
        {
            await AcceptLoopCoreAsync(listener, token).ConfigureAwait(false);
        }
        finally
        {
            lock (_gate)
            {
                if (ReferenceEquals(_listener, listener)) IsListening = false;
            }
        }
    }

    private async Task AcceptLoopCoreAsync(TcpListener listener, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch
            {
                break;
            }

            if (token.IsCancellationRequested)
            {
                client.Close();
                break;
            }

            client.NoDelay = true;
            client.SendTimeout = 1000;

            TcpClient? previousClient;
            NetworkStream? previousStream;
            string endpoint;
            lock (_gate)
            {
                previousClient = _client;
                previousStream = _stream;
                _client = client;
                _stream = client.GetStream();
                ClientEndpoint = client.Client.RemoteEndPoint?.ToString() ?? "unknown";
                endpoint = ClientEndpoint;
            }

            try { previousStream?.Dispose(); } catch { /* replaced */ }
            try { previousClient?.Close(); } catch { /* replaced */ }

            ClientChanged?.Invoke(true, endpoint);
        }
    }

    private void CloseClientLocked()
    {
        var stream = _stream;
        var client = _client;
        _stream = null;
        _client = null;
        ClientEndpoint = string.Empty;

        try { stream?.Dispose(); } catch { /* closing */ }
        try { client?.Close(); } catch { /* closing */ }
    }

    public void Dispose()
    {
        Stop();
    }
}
