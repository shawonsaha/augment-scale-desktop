using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data;

internal static class SchemaMigrator
{
    public static void Apply(SqliteConnection connection)
    {
        using (var create = connection.CreateCommand())
        {
            create.CommandText = """
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                """;
            create.ExecuteNonQuery();
        }

        long version = 0;
        using (var read = connection.CreateCommand())
        {
            read.CommandText = "SELECT COALESCE(MAX(version), 0) FROM schema_version;";
            version = Convert.ToInt64(read.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        if (version < 1)
        {
            var sql = ReadEmbeddedSql("V001_InitialSchema.sql");
            using var apply = connection.CreateCommand();
            apply.CommandText = sql;
            apply.ExecuteNonQuery();
            using var record = connection.CreateCommand();
            record.CommandText = "INSERT INTO schema_version (version, name) VALUES (1, 'InitialSchema');";
            record.ExecuteNonQuery();
        }
    }

    private static string ReadEmbeddedSql(string suffix)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var name = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"Embedded schema '{suffix}' was not found.");
        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Embedded schema '{suffix}' could not be opened.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    }
}
