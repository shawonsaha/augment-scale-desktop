using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Velopack.Sources;

namespace AugmentScale.Services;

/// <summary>
/// Secure file downloader for Velopack that attaches Supabase authentication headers
/// (apikey and Bearer token) to all download requests, enabling client workstations
/// to safely pull update manifests and packages from private Supabase Storage buckets.
/// </summary>
internal sealed class SupabaseAuthenticatedFileDownloader : IFileDownloader
{
    private readonly HttpClientFileDownloader _inner = new();
    private readonly string? _apiKey;

    public SupabaseAuthenticatedFileDownloader(string? apiKey)
    {
        _apiKey = apiKey;
    }

    private IDictionary<string, string> AttachAuthHeaders(IDictionary<string, string>? existing)
    {
        var headers = existing != null
            ? new Dictionary<string, string>(existing, StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            headers["apikey"] = _apiKey;
            headers["Authorization"] = $"Bearer {_apiKey}";
        }

        return headers;
    }

    public Task DownloadFile(string url, string targetFile, Action<int> progress, IDictionary<string, string>? headers, double timeout, CancellationToken cancellationToken)
    {
        return _inner.DownloadFile(url, targetFile, progress, AttachAuthHeaders(headers), timeout, cancellationToken);
    }

    public Task<byte[]> DownloadBytes(string url, IDictionary<string, string>? headers, double timeout)
    {
        return _inner.DownloadBytes(url, AttachAuthHeaders(headers), timeout);
    }

    public Task<string> DownloadString(string url, IDictionary<string, string>? headers, double timeout)
    {
        return _inner.DownloadString(url, AttachAuthHeaders(headers), timeout);
    }
}
