using System.Text.Json;

namespace AugmentScale.Data;

internal static class JsonDefaults
{
    public static readonly JsonSerializerOptions CamelCase = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
}
