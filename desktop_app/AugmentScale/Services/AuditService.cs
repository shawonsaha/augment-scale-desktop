using System.Text.Json;
using AugmentScale.Models;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Services;

/// <summary>
/// Append-only audit writer. Callers pass the active connection/transaction so
/// the business mutation and its audit row commit or roll back together.
/// </summary>
public sealed class AuditService
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public void Insert(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        AuditEvent auditEvent)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = """
            INSERT INTO audit_events (
                id, organization_id, entity_type, entity_id, action,
                before_values, after_values, changed_fields,
                actor_user_id, actor_role, actor_display_name,
                source, workstation_id, client_event_id, change_reason, created_at
            ) VALUES (
                $id, $org, $entityType, $entityId, $action,
                $before, $after, $changed,
                $actorId, $actorRole, $actorName,
                $source, $workstationId, $clientEventId, $reason, $createdAt
            );
            """;
        cmd.Parameters.AddWithValue("$id", auditEvent.Id);
        cmd.Parameters.AddWithValue("$org", auditEvent.OrganizationId);
        cmd.Parameters.AddWithValue("$entityType", auditEvent.EntityType);
        cmd.Parameters.AddWithValue("$entityId", auditEvent.EntityId);
        cmd.Parameters.AddWithValue("$action", auditEvent.Action);
        cmd.Parameters.AddWithValue("$before", (object?)auditEvent.BeforeValues ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$after", (object?)auditEvent.AfterValues ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$changed", (object?)auditEvent.ChangedFields ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$actorId", (object?)auditEvent.ActorUserId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$actorRole", (object?)auditEvent.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$actorName", (object?)auditEvent.ActorDisplayName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$source", auditEvent.Source);
        cmd.Parameters.AddWithValue("$workstationId", (object?)auditEvent.WorkstationId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$clientEventId", (object?)auditEvent.ClientEventId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$reason", (object?)auditEvent.ChangeReason ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$createdAt", auditEvent.CreatedAt.ToString("O"));
        cmd.ExecuteNonQuery();
    }

    public void InsertMutation(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        string organizationId,
        string workstationId,
        string entityType,
        string entityId,
        string action,
        string? actorId,
        string? actorName,
        object? after,
        object? before = null,
        string? reason = null)
    {
        Insert(connection, transaction, new AuditEvent
        {
            OrganizationId = organizationId,
            WorkstationId = workstationId,
            EntityType = entityType,
            EntityId = entityId,
            Action = action,
            ActorUserId = actorId,
            ActorDisplayName = actorName,
            Source = "workstation",
            ChangeReason = reason,
            BeforeValues = before is null ? null : JsonSerializer.Serialize(before, Json),
            AfterValues = after is null ? null : JsonSerializer.Serialize(after, Json),
        });
    }
}
