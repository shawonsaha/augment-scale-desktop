using System.Globalization;
using System.IO;
using System.Text;

namespace AugmentScale.Services;

/// <summary>Minimal rolling file log for startup and unhandled errors.</summary>
public static class AppLog
{
    private static readonly object Gate = new();
    private static string? _directory;

    public static void Initialize(string directory)
    {
        _directory = directory;
        Directory.CreateDirectory(directory);
        Prune();
    }

    public static void Info(string message) => Write("INFO", message);
    public static void Error(string message, Exception? exception = null) =>
        Write("ERROR", exception is null ? message : $"{message}{Environment.NewLine}{exception}");

    private static void Write(string level, string message)
    {
        if (_directory is null) return;
        try
        {
            lock (Gate)
            {
                var file = Path.Combine(_directory,
                    $"app-{DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}.log");
                File.AppendAllText(file,
                    $"{DateTimeOffset.Now:O} [{level}] {message}{Environment.NewLine}",
                    Encoding.UTF8);
            }
        }
        catch
        {
            // Logging must never crash the app.
        }
    }

    private static void Prune()
    {
        try
        {
            if (_directory is null) return;
            var cutoff = DateTime.Now.AddDays(-30);
            foreach (var file in Directory.EnumerateFiles(_directory, "app-*.log"))
            {
                if (File.GetLastWriteTime(file) < cutoff) File.Delete(file);
            }
        }
        catch
        {
            // Ignore.
        }
    }
}
