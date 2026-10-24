using System.Globalization;
using System.Text.RegularExpressions;
using AugmentScale.Models;
using AugmentScale.Models.Commands;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data.Repositories;

internal sealed class OperatorRepository : IOperatorRepository
{
    private static readonly string[] ProfileRoles =
    [
        "Supervisor", "Senior Operator", "Operator", "Relief Operator",
    ];

    private static readonly string[] ProfileShifts =
    [
        "Shift A", "Shift B", "Shift C",
    ];

    private static readonly HashSet<string> ProfileAvatars = new(StringComparer.OrdinalIgnoreCase)
    {
        "avatars/frame-1.svg", "avatars/frame-3.svg", "avatars/frame-4.svg",
        "avatars/frame-5.svg", "avatars/frame-9.svg",
    };

    private static readonly Regex ProfileCodePattern = new(
        "^[A-Z0-9]{1,4}$", RegexOptions.CultureInvariant);

    private static readonly Regex ProfileColorPattern = new(
        "^#[0-9A-Fa-f]{6}$", RegexOptions.CultureInvariant);

    private readonly DatabaseContext _db;

    public OperatorRepository(DatabaseContext db)
    {
        _db = db;
    }

    public IReadOnlyList<ProfileDto> GetOperators()
    {
        _db.EnsureInitialized();
        using var connection = _db.OpenConnection();
        return GetOperators(connection);
    }

    internal IReadOnlyList<ProfileDto> GetOperators(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT p.id, p.display_name, p.first_name, p.initials, p.avatar_url,
                   p.color, p.shift, r.role
            FROM profiles p
            LEFT JOIN user_roles r ON r.profile_id = p.id AND r.revoked_at IS NULL
            WHERE p.organization_id = $org AND p.is_active = 1 AND p.deleted_at IS NULL
            ORDER BY p.created_at;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);

        var results = new List<ProfileDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var id = SqliteHelpers.Text(reader, "id") ?? string.Empty;
            results.Add(new ProfileDto
            {
                Id = id,
                Code = SqliteHelpers.Text(reader, "initials") ?? id.ToUpperInvariant(),
                Name = SqliteHelpers.Text(reader, "display_name") ?? id,
                FirstName = SqliteHelpers.Text(reader, "first_name") ?? "",
                Role = ProfileRoleDisplay(SqliteHelpers.Text(reader, "role") ?? "operator"),
                Shift = SqliteHelpers.Text(reader, "shift") ?? "Shift A",
                Avatar = SqliteHelpers.Text(reader, "avatar_url") ?? "avatars/frame-9.svg",
                Color = SqliteHelpers.Text(reader, "color") ?? "#4C7875",
                PinSet = _db.Config.HasPin(id),
            });
        }
        return results;
    }

    public ProfileDto? AuthenticateOperator(string profileId, string pin)
    {
        if (!_db.Config.AuthenticatePin(profileId, pin)) return null;
        return GetOperators().FirstOrDefault(o => o.Id.Equals(profileId, StringComparison.OrdinalIgnoreCase));
    }

    public ProfileDto? AuthenticateSupervisor(string profileId, string pin)
    {
        var profile = AuthenticateOperator(profileId, pin);
        return profile is not null &&
               profile.Role.Equals("Supervisor", StringComparison.OrdinalIgnoreCase)
            ? profile
            : null;
    }

    public ProfileDto CreateProfile(ProfileWriteRequest request, string actorId, string actorName)
    {
        _db.EnsureInitialized();
        NormalizeProfileFields(request);
        ValidatePin(request.Pin);

        var id = ("p-" + Guid.NewGuid().ToString("N"))[..12];
        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();

        EnsureProfileCodeAvailable(connection, txn, request.Code, null);

        var now = DateTimeOffset.Now.ToString("O");
        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO profiles (
                id, organization_id, display_name, first_name, initials, avatar_url,
                color, shift, is_active, created_at, updated_at
            ) VALUES ($id, $org, $name, $first, $initials, $avatar, $color, $shift, 1, $now, $now);
            """,
            ("$id", id), ("$org", _db.OrganizationId), ("$name", request.DisplayName),
            ("$first", request.FirstName), ("$initials", request.Code),
            ("$avatar", request.Avatar), ("$color", request.Color),
            ("$shift", request.Shift), ("$now", now));

        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO user_roles (id, profile_id, organization_id, site_id, role, granted_at, granted_by)
            VALUES ($id, $profile, $org, $site, $role, $now, $actor);
            """,
            ("$id", $"role-{id}"), ("$profile", id), ("$org", _db.OrganizationId),
            ("$site", _db.SiteId), ("$role", request.Role.ToLowerInvariant()),
            ("$now", now), ("$actor", actorName));

        var record = new ProfileDto
        {
            Id = id,
            Code = request.Code,
            Name = request.DisplayName,
            FirstName = request.FirstName,
            Role = request.Role,
            Shift = request.Shift,
            Avatar = request.Avatar,
            Color = request.Color,
        };
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "profiles", id, "create", actorId, actorName, record);
        _db.InsertOutbox(connection, txn, "profiles", id, "insert", record, actorId);
        txn.Commit();

        _db.Config.SetPin(id, request.Pin);
        return GetOperators().First(op => op.Id == id);
    }

    public ProfileDto UpdateProfile(ProfileWriteRequest request, string actorId, string actorName)
    {
        _db.EnsureInitialized();
        if (string.IsNullOrWhiteSpace(request.Id))
            throw new InvalidOperationException("Profile is required.");
        NormalizeProfileFields(request);

        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();
        var before = LoadProfile(connection, txn, request.Id)
                     ?? throw new InvalidOperationException("Profile not found.");

        EnsureProfileCodeAvailable(connection, txn, request.Code, before.Id);

        var losingSupervisor = before.Role.Equals("Supervisor", StringComparison.OrdinalIgnoreCase) &&
                               !request.Role.Equals("Supervisor", StringComparison.OrdinalIgnoreCase);
        if (losingSupervisor && CountActiveSupervisors(connection, txn) <= 1)
            throw new InvalidOperationException("At least one active supervisor is required.");

        var now = DateTimeOffset.Now.ToString("O");
        SqliteHelpers.Exec(connection, txn, """
            UPDATE profiles SET
                display_name = $name,
                first_name = $first,
                initials = $initials,
                avatar_url = $avatar,
                color = $color,
                shift = $shift,
                updated_at = $now
            WHERE id = $id;
            """,
            ("$id", before.Id), ("$name", request.DisplayName), ("$first", request.FirstName),
            ("$initials", request.Code), ("$avatar", request.Avatar),
            ("$color", request.Color), ("$shift", request.Shift), ("$now", now));

        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO user_roles (id, profile_id, organization_id, site_id, role, granted_at, granted_by)
            VALUES ($id, $profile, $org, $site, $role, $now, $actor)
            ON CONFLICT(id) DO UPDATE SET
                role = excluded.role,
                revoked_at = NULL,
                revoked_by = NULL;
            """,
            ("$id", $"role-{before.Id}"), ("$profile", before.Id), ("$org", _db.OrganizationId),
            ("$site", _db.SiteId), ("$role", request.Role.ToLowerInvariant()),
            ("$now", now), ("$actor", actorName));

        var after = new ProfileDto
        {
            Id = before.Id,
            Code = request.Code,
            Name = request.DisplayName,
            FirstName = request.FirstName,
            Role = request.Role,
            Shift = request.Shift,
            Avatar = request.Avatar,
            Color = request.Color,
            PinSet = before.PinSet,
        };
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "profiles", before.Id, "update", actorId, actorName, after, before);
        _db.InsertOutbox(connection, txn, "profiles", before.Id, "update", after, actorId);
        txn.Commit();

        return after;
    }

    public bool SetProfilePin(SetProfilePinRequest request, string actorId, string actorName)
    {
        _db.EnsureInitialized();
        ValidatePin(request.Pin);

        using var connection = _db.OpenConnection();
        var target = LoadProfile(connection, null, request.ProfileId)
                     ?? throw new InvalidOperationException("Profile not found.");

        _db.Config.SetPin(target.Id, request.Pin);

        using var txn = connection.BeginTransaction();
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "profiles", target.Id, "pin_change", actorId, actorName,
            new { pinChanged = true });
        txn.Commit();
        return true;
    }

    public bool DeactivateProfile(DeactivateProfileRequest request, string actorId, string actorName)
    {
        _db.EnsureInitialized();
        var reason = (request.Reason ?? "").Trim();
        if (reason.Length == 0)
            throw new InvalidOperationException("A removal reason is required.");

        using var connection = _db.OpenConnection();
        using var txn = connection.BeginTransaction();
        var target = LoadProfile(connection, txn, request.ProfileId)
                     ?? throw new InvalidOperationException("Profile not found.");

        if (target.Id.Equals(actorId, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("You cannot remove your own profile.");
        if (target.Role.Equals("Supervisor", StringComparison.OrdinalIgnoreCase) &&
            CountActiveSupervisors(connection, txn) <= 1)
            throw new InvalidOperationException("At least one active supervisor is required.");

        var now = DateTimeOffset.Now.ToString("O");
        SqliteHelpers.Exec(connection, txn, """
            UPDATE profiles SET
                is_active = 0,
                deleted_at = $now,
                deleted_by = $actor,
                updated_at = $now
            WHERE id = $id;
            """,
            ("$id", target.Id), ("$now", now), ("$actor", actorName));

        SqliteHelpers.Exec(connection, txn, """
            UPDATE user_roles SET revoked_at = $now, revoked_by = $actor
            WHERE profile_id = $id AND revoked_at IS NULL;
            """,
            ("$id", target.Id), ("$now", now), ("$actor", actorName));

        var after = new
        {
            target.Id, target.Name, target.Code, target.Role, target.Shift,
            IsActive = false, DeletedAt = now, DeletedBy = actorName, Reason = reason,
        };
        _db.Audit.InsertMutation(connection, txn, _db.OrganizationId, _db.WorkstationId,
            "profiles", target.Id, "deactivate", actorId, actorName, after, target, reason);
        _db.InsertOutbox(connection, txn, "profiles", target.Id, "update", after, actorId, reason);
        txn.Commit();

        _db.Config.RemovePin(target.Id);
        return true;
    }

    internal static string ResolveOperatorName(SqliteConnection connection, SqliteTransaction txn,
        string operatorId, string fallback)
    {
        if (!string.IsNullOrWhiteSpace(operatorId))
        {
            using var cmd = connection.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = "SELECT display_name FROM profiles WHERE id = $id;";
            cmd.Parameters.AddWithValue("$id", operatorId);
            if (cmd.ExecuteScalar() is string name && name.Length > 0) return name;
        }
        return string.IsNullOrWhiteSpace(fallback) ? "Unknown Operator" : fallback;
    }

    private ProfileDto? LoadProfile(SqliteConnection connection, SqliteTransaction? txn, string id)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT p.id, p.display_name, p.first_name, p.initials, p.avatar_url,
                   p.color, p.shift, r.role
            FROM profiles p
            LEFT JOIN user_roles r ON r.profile_id = p.id AND r.revoked_at IS NULL
            WHERE p.id = $id AND p.organization_id = $org
              AND p.is_active = 1 AND p.deleted_at IS NULL;
            """;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);

        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return null;
        var profileId = SqliteHelpers.Text(reader, "id") ?? string.Empty;
        return new ProfileDto
        {
            Id = profileId,
            Code = SqliteHelpers.Text(reader, "initials") ?? profileId.ToUpperInvariant(),
            Name = SqliteHelpers.Text(reader, "display_name") ?? profileId,
            FirstName = SqliteHelpers.Text(reader, "first_name") ?? "",
            Role = ProfileRoleDisplay(SqliteHelpers.Text(reader, "role") ?? "operator"),
            Shift = SqliteHelpers.Text(reader, "shift") ?? "Shift A",
            Avatar = SqliteHelpers.Text(reader, "avatar_url") ?? "avatars/frame-9.svg",
            Color = SqliteHelpers.Text(reader, "color") ?? "#4C7875",
            PinSet = _db.Config.HasPin(profileId),
        };
    }

    private void EnsureProfileCodeAvailable(
        SqliteConnection connection, SqliteTransaction txn, string code, string? excludeId)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT COUNT(*) FROM profiles
            WHERE organization_id = $org
              AND UPPER(initials) = $code
              AND deleted_at IS NULL
              AND id <> $exclude;
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        cmd.Parameters.AddWithValue("$code", code);
        cmd.Parameters.AddWithValue("$exclude", excludeId ?? "");
        if (Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) > 0)
            throw new InvalidOperationException($"Operator code '{code}' is already in use.");
    }

    private int CountActiveSupervisors(SqliteConnection connection, SqliteTransaction txn)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = txn;
        cmd.CommandText = """
            SELECT COUNT(DISTINCT p.id)
            FROM profiles p
            JOIN user_roles r ON r.profile_id = p.id AND r.revoked_at IS NULL
            WHERE p.organization_id = $org
              AND p.is_active = 1 AND p.deleted_at IS NULL
              AND LOWER(r.role) = 'supervisor';
            """;
        cmd.Parameters.AddWithValue("$org", _db.OrganizationId);
        return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private static void NormalizeProfileFields(ProfileWriteRequest request)
    {
        request.DisplayName = (request.DisplayName ?? "").Trim();
        request.FirstName = (request.FirstName ?? "").Trim();
        request.Code = (request.Code ?? "").Trim().ToUpperInvariant();
        request.Role = (request.Role ?? "").Trim();
        request.Shift = (request.Shift ?? "").Trim();
        request.Avatar = (request.Avatar ?? "").Trim();
        request.Color = (request.Color ?? "").Trim();

        if (request.DisplayName.Length is 0 or > 80)
            throw new InvalidOperationException("Display name is required (80 characters maximum).");
        if (request.FirstName.Length > 80)
            throw new InvalidOperationException("First name is too long.");
        if (!ProfileCodePattern.IsMatch(request.Code))
            throw new InvalidOperationException("Operator code must be 1-4 letters or digits.");

        request.Role = ProfileRoles.FirstOrDefault(
            role => role.Equals(request.Role, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("Select a valid role.");
        request.Shift = ProfileShifts.FirstOrDefault(
            shift => shift.Equals(request.Shift, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("Select a valid shift.");
        if (!ProfileAvatars.Contains(request.Avatar))
            throw new InvalidOperationException("Select a valid avatar.");
        if (!ProfileColorPattern.IsMatch(request.Color))
            throw new InvalidOperationException("Select a valid profile color.");
    }

    private static void ValidatePin(string? pin)
    {
        if (pin is null || pin.Length != 4 || !pin.All(char.IsAsciiDigit))
            throw new InvalidOperationException("PIN must be exactly 4 digits.");
    }

    private static string ProfileRoleDisplay(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        return ProfileRoles.FirstOrDefault(
            role => role.Equals(value, StringComparison.OrdinalIgnoreCase)) ?? SqliteHelpers.TitleCase(value);
    }
}
