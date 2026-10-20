using System.Text.Json;

namespace AugmentScale.Models.Commands;

public sealed class CommandEnvelope
{
    public string Command { get; set; } = string.Empty;
    public JsonElement Payload { get; set; }
    public string RequestId { get; set; } = string.Empty;
}

public sealed class CommandResponse
{
    public string Type { get; set; } = "commandResponse";
    public string RequestId { get; set; } = string.Empty;
    public bool Success { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }

    public static CommandResponse Ok(string requestId, object? data = null) =>
        new() { RequestId = requestId, Success = true, Data = data };

    public static CommandResponse Fail(string requestId, string error) =>
        new() { RequestId = requestId, Success = false, Error = error };
}
