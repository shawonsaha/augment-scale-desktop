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

        var appliedVersions = new HashSet<long>();
        using (var read = connection.CreateCommand())
        {
            read.CommandText = "SELECT version FROM schema_version;";
            using var reader = read.ExecuteReader();
            while (reader.Read())
            {
                appliedVersions.Add(reader.GetInt64(0));
            }
        }

        if (!appliedVersions.Contains(1))
        {
            var sql = ReadEmbeddedSql("V001_InitialSchema.sql");
            using var apply = connection.CreateCommand();
            apply.CommandText = sql;
            apply.ExecuteNonQuery();
            using var record = connection.CreateCommand();
            record.CommandText = "INSERT INTO schema_version (version, name) VALUES (1, 'InitialSchema');";
            record.ExecuteNonQuery();
        }

        if (!appliedVersions.Contains(2))
        {
            var sql = ReadEmbeddedSql("V002_ArchiveRuns.sql");
            using var txn = connection.BeginTransaction();
            using var apply = connection.CreateCommand();
            apply.Transaction = txn;
            apply.CommandText = sql;
            apply.ExecuteNonQuery();
            using var record = connection.CreateCommand();
            record.Transaction = txn;
            record.CommandText = "INSERT INTO schema_version (version, name) VALUES (2, 'ArchiveRuns');";
            record.ExecuteNonQuery();
            txn.Commit();
        }

        if (!appliedVersions.Contains(3))
        {
            var sql = ReadEmbeddedSql("V003_CloudSync.sql");
            using var txn = connection.BeginTransaction();
            foreach (var statement in sql.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (string.IsNullOrWhiteSpace(statement)) continue;
                try
                {
                    using var apply = connection.CreateCommand();
                    apply.Transaction = txn;
                    apply.CommandText = statement;
                    apply.ExecuteNonQuery();
                }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
                {
                    // Column already exists, safe to ignore
                }
            }
            using var record = connection.CreateCommand();
            record.Transaction = txn;
            record.CommandText = "INSERT INTO schema_version (version, name) VALUES (3, 'CloudSync');";
            record.ExecuteNonQuery();
            txn.Commit();
        }

        if (!appliedVersions.Contains(4))
        {
            var sql = ReadEmbeddedSql("V004_Hardening.sql");
            using var txn = connection.BeginTransaction();
            using var apply = connection.CreateCommand();
            apply.Transaction = txn;
            apply.CommandText = sql;
            apply.ExecuteNonQuery();
            using var record = connection.CreateCommand();
            record.Transaction = txn;
            record.CommandText = "INSERT INTO schema_version (version, name) VALUES (4, 'Hardening');";
            record.ExecuteNonQuery();
            txn.Commit();
        }

        if (!appliedVersions.Contains(5))
        {
            var sql = ReadEmbeddedSql("V005_TicketSequenceWatermark.sql");
            using var txn = connection.BeginTransaction();
            foreach (var statement in sql.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (string.IsNullOrWhiteSpace(statement)) continue;
                try
                {
                    using var apply = connection.CreateCommand();
                    apply.Transaction = txn;
                    apply.CommandText = statement;
                    apply.ExecuteNonQuery();
                }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
                {
                    // Column already exists, safe to ignore
                }
            }
            using var record = connection.CreateCommand();
            record.Transaction = txn;
            record.CommandText = "INSERT INTO schema_version (version, name) VALUES (5, 'TicketSequenceWatermark');";
            record.ExecuteNonQuery();
            txn.Commit();
        }

        if (!appliedVersions.Contains(6))
        {
            var sql = ReadEmbeddedSql("V006_OutboxDeadLetterStatus.sql");
            using var txn = connection.BeginTransaction();
            foreach (var statement in sql.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (string.IsNullOrWhiteSpace(statement)) continue;
                using var apply = connection.CreateCommand();
                apply.Transaction = txn;
                apply.CommandText = statement;
                apply.ExecuteNonQuery();
            }
            using var record = connection.CreateCommand();
            record.Transaction = txn;
            record.CommandText = "INSERT INTO schema_version (version, name) VALUES (6, 'OutboxDeadLetterStatus');";
            record.ExecuteNonQuery();
            txn.Commit();
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
