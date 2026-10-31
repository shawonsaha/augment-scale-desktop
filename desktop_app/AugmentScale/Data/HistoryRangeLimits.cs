using System.Globalization;

namespace AugmentScale.Data;

/// <summary>
/// Bounds interactive history and report queries. The automatic archive
/// baseline is exempt because it may legitimately span every stored ticket.
/// </summary>
internal static class HistoryRangeLimits
{
    public const int MaxDays = 366;

    public static DateOnly ParseDate(string value, string label)
    {
        if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var date))
            throw new InvalidOperationException($"Choose a valid {label} date.");
        return date;
    }

    public static void EnsureValidRange(DateOnly from, DateOnly to, string label)
    {
        if (from > to)
            throw new InvalidOperationException($"The {label} start date must be before the end date.");
        if (to.DayNumber - from.DayNumber + 1 > MaxDays)
            throw new InvalidOperationException($"Choose a {label} range of one year or less.");
    }

    public static (string FromUtc, string ToUtc) GetUtcDayRange(DateOnly fromDay, DateOnly toDay, TimeZoneInfo timeZone)
    {
        var tz = timeZone ?? TimeZoneInfo.Local;
        var fromLocal = fromDay.ToDateTime(TimeOnly.MinValue);
        var toLocal = toDay.ToDateTime(TimeOnly.MinValue).AddDays(1);
        var fromUtc = TimeZoneInfo.ConvertTimeToUtc(fromLocal, tz)
            .ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        var toUtc = TimeZoneInfo.ConvertTimeToUtc(toLocal, tz)
            .ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        return (fromUtc, toUtc);
    }
}
