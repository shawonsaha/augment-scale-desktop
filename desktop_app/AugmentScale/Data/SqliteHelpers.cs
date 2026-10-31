using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data;

internal static class SqliteHelpers
{
    private static readonly string[] WebUiTimestampFormats =
    {
        "dd-MM-yy hh:mm:ss tt",
        "dd-MM-yyyy hh:mm:ss tt",
    };

    public static void Exec(SqliteConnection connection, SqliteTransaction? txn,
        string sql, params (string Name, object? Value)[] parameters)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }
        cmd.ExecuteNonQuery();
    }

    public static string? Text(SqliteDataReader reader, string name)
    {
        var i = reader.GetOrdinal(name);
        return reader.IsDBNull(i) ? null : Convert.ToString(reader.GetValue(i), CultureInfo.InvariantCulture);
    }

    public static double? Number(SqliteDataReader reader, string name)
    {
        var i = reader.GetOrdinal(name);
        return reader.IsDBNull(i) ? null : Convert.ToDouble(reader.GetValue(i), CultureInfo.InvariantCulture);
    }

    public static string NormalizePlate(string plate) =>
        string.Join(' ', plate.Trim().ToUpperInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));

    public static string StableId(string kind, string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{kind}:{value}"));
        return new Guid(bytes.AsSpan(0, 16)).ToString();
    }

    public static string OperatorId(string? id) =>
        string.IsNullOrWhiteSpace(id) ? "system" : id;

    public static string TitleCase(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        return char.ToUpperInvariant(value[0]) + value[1..].ToLowerInvariant();
    }

    public static DateTimeOffset? ParseTimestamp(string? value, TimeZoneInfo? timeZone = null)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateTime.TryParseExact(value, WebUiTimestampFormats, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out var localParsed))
        {
            var tz = timeZone ?? TimeZoneInfo.Local;
            var offset = tz.GetUtcOffset(localParsed);
            return new DateTimeOffset(localParsed, offset);
        }
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out var parsed))
        {
            return parsed;
        }
        return null;
    }

    public static string FormatTimestamp(DateTimeOffset? value, TimeZoneInfo? timeZone = null)
    {
        if (value is null) return "";
        var tz = timeZone ?? TimeZoneInfo.Local;
        var converted = TimeZoneInfo.ConvertTime(value.Value, tz);
        return converted.ToString("dd-MM-yy hh:mm:ss tt", CultureInfo.InvariantCulture);
    }

    public static string FormatElapsed(DateTimeOffset? createdAt)
    {
        if (createdAt is null) return "";
        var span = DateTimeOffset.Now - createdAt.Value;
        if (span.TotalMinutes < 1) return "Just now";
        if (span.TotalMinutes < 60) return $"{Math.Max(1, (int)span.TotalMinutes)} mins";
        if (span.TotalHours < 24) return $"{span.TotalHours:0.#} hrs";
        return $"{Math.Max(1, (int)span.TotalDays)} days";
    }

    public static string? SerializeJsonElement(JsonElement? element)
    {
        if (element is null || element.Value.ValueKind == JsonValueKind.Null) return null;
        return element.Value.ValueKind == JsonValueKind.String
            ? element.Value.GetString()
            : element.Value.GetRawText();
    }
}
