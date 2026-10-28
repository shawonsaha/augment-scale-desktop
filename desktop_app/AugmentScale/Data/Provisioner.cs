using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace AugmentScale.Data;

internal static class Provisioner
{
    public static void Provision(DatabaseContext db, SqliteConnection connection)
    {
        var setup = db.Config.Setup;
        var now = DateTimeOffset.Now.ToString("O");

        using var txn = connection.BeginTransaction();

        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO organizations (id, name, address, phone, email, created_at, updated_at)
            VALUES ($id, $name, $address, $phone, $email, $now, $now)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                address = excluded.address,
                phone = excluded.phone,
                email = excluded.email,
                updated_at = excluded.updated_at;
            """,
            ("$id", db.OrganizationId), ("$name", setup.Organization.Name),
            ("$address", setup.Organization.Address), ("$phone", setup.Organization.Phone),
            ("$email", setup.Organization.Email), ("$now", now));

        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO sites (id, organization_id, name, address, timezone, created_at, updated_at)
            VALUES ($id, $org, $name, $address, $timezone, $now, $now)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                address = excluded.address,
                timezone = excluded.timezone,
                updated_at = excluded.updated_at;
            """,
            ("$id", db.SiteId), ("$org", db.OrganizationId), ("$name", setup.Site.Name),
            ("$address", setup.Site.Address), ("$timezone", setup.Site.Timezone), ("$now", now));

        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO weighbridges (id, site_id, name, max_capacity_kg, min_division_kg, created_at, updated_at)
            VALUES ($id, $site, $name, $max, $min, $now, $now)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                max_capacity_kg = excluded.max_capacity_kg,
                min_division_kg = excluded.min_division_kg,
                updated_at = excluded.updated_at;
            """,
            ("$id", db.WeighbridgeId), ("$site", db.SiteId), ("$name", setup.Weighbridge.Name),
            ("$max", setup.Weighbridge.MaxCapacityKg), ("$min", setup.Weighbridge.MinDivisionKg),
            ("$now", now));

        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO workstations (
                id, organization_id, site_id, weighbridge_id, hostname, registered_at,
                last_seen_at, settings, created_at, updated_at
            ) VALUES ($id, $org, $site, $wb, $host, $now, $now, $settings, $now, $now)
            ON CONFLICT(id) DO UPDATE SET
                hostname = excluded.hostname,
                last_seen_at = excluded.last_seen_at,
                settings = excluded.settings,
                updated_at = excluded.updated_at;
            """,
            ("$id", db.WorkstationId), ("$org", db.OrganizationId), ("$site", db.SiteId),
            ("$wb", db.WeighbridgeId), ("$host", Environment.MachineName), ("$now", now),
            ("$settings", JsonSerializer.Serialize(new { appVersion = "1.0.0" }, JsonDefaults.CamelCase)));

        var scale = setup.ScaleConnection;
        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO scale_connection_profiles (
                id, weighbridge_id, port_name, baud_rate, data_bits, parity, stop_bits,
                protocol_format, stability_window_ms, stability_tolerance_kg,
                effective_from, version, approved_by, change_reason, created_at
            ) VALUES (
                $id, $wb, $port, $baud, $dataBits, $parity, $stopBits,
                $format, $window, $tolerance, $from, 1, 'setup.json', 'first-run provisioning', $now
            )
            ON CONFLICT(id) DO UPDATE SET
                port_name = excluded.port_name,
                baud_rate = excluded.baud_rate,
                data_bits = excluded.data_bits,
                parity = excluded.parity,
                stop_bits = excluded.stop_bits,
                protocol_format = excluded.protocol_format,
                stability_window_ms = excluded.stability_window_ms,
                stability_tolerance_kg = excluded.stability_tolerance_kg;
            """,
            ("$id", db.ScaleProfileId), ("$wb", db.WeighbridgeId), ("$port", scale.PortName),
            ("$baud", scale.BaudRate), ("$dataBits", scale.DataBits), ("$parity", scale.Parity),
            ("$stopBits", scale.StopBits), ("$format", scale.ProtocolFormat),
            ("$window", scale.StabilityWindowMs), ("$tolerance", scale.StabilityToleranceKg),
            ("$from", now), ("$now", now));

        foreach (var op in setup.Operators)
        {
            if (string.IsNullOrWhiteSpace(op.Id)) op.Id = SqliteHelpers.StableId("profile", op.DisplayName)[..12];
            SqliteHelpers.Exec(connection, txn, """
                INSERT INTO profiles (
                    id, organization_id, display_name, first_name, initials, avatar_url,
                    color, shift, is_active, created_at, updated_at
                ) VALUES ($id, $org, $name, $first, $initials, $avatar, $color, $shift, 1, $now, $now)
                ON CONFLICT(id) DO NOTHING;
                """,
                ("$id", op.Id), ("$org", db.OrganizationId), ("$name", op.DisplayName),
                ("$first", op.FirstName), ("$initials", op.Code), ("$avatar", op.Avatar),
                ("$color", op.Color), ("$shift", op.Shift), ("$now", now));

            SqliteHelpers.Exec(connection, txn, """
                INSERT INTO user_roles (id, profile_id, organization_id, site_id, role, granted_at, granted_by)
                VALUES ($id, $profile, $org, $site, $role, $now, 'setup.json')
                ON CONFLICT(id) DO NOTHING;
                """,
                ("$id", $"role-{op.Id}"), ("$profile", op.Id), ("$org", db.OrganizationId),
                ("$site", db.SiteId), ("$role", op.Role.ToLowerInvariant()), ("$now", now));
        }

        // Demo plates are for development only. Release builds start with an empty
        // vehicle list so a fresh install cannot collide with another workstation's
        // seeded plates on the unique (organization_id, plate_normalized) index.
#if DEBUG
        SeedVehiclesIfEmpty(db, connection, txn, now);
#endif

        SqliteHelpers.Exec(connection, txn, """
            INSERT INTO sync_cursors (id, last_sync_change_id, last_synced_at)
            SELECT 'local', 0, $now
            WHERE NOT EXISTS (SELECT 1 FROM sync_cursors);
            """, ("$now", now));

        txn.Commit();
    }

#if DEBUG
    private static void SeedVehiclesIfEmpty(DatabaseContext db, SqliteConnection connection,
        SqliteTransaction txn, string now)
    {
        using var count = connection.CreateCommand();
        count.Transaction = txn;
        count.CommandText = "SELECT COUNT(*) FROM vehicles WHERE organization_id = $org;";
        count.Parameters.AddWithValue("$org", db.OrganizationId);
        if (Convert.ToInt64(count.ExecuteScalar(), CultureInfo.InvariantCulture) > 0) return;

        var seeds = new (string Plate, string Driver, string Phone, string Material, string Client)[]
        {
            ("DM-T-11-2045", "Kalam Hossain", "+880 1711 002233", "Scrap Iron", "BSRM Steels Ltd"),
            ("CTG-4512", "Anwar Ali", "+880 1819 445566", "MS Plate", "Abul Khair Steel"),
            ("DM-K-33-1078", "Sumon Mia", "+880 1912 778899", "Pipe", "Apex Cement Mills"),
            ("DHAKA-METRO-TA-14-9921", "Rafiqul Islam", "+880 1670 112233", "Machinery", "GPH Ispat"),
            ("CTG-TA-12-8844", "Jasmin Uddin", "+880 1552 998877", "Copper / Cable", "Crown Cement"),
        };

        foreach (var seed in seeds)
        {
            SqliteHelpers.Exec(connection, txn, """
                INSERT INTO vehicles (
                    id, organization_id, plate_number, plate_normalized,
                    default_driver_name, default_driver_phone, default_client,
                    default_material, registered_by, created_at, updated_at
                ) VALUES ($id, $org, $plate, $normalized, $driver, $phone, $client, $material, 'setup.json', $now, $now);
                """,
                ("$id", Guid.NewGuid().ToString()), ("$org", db.OrganizationId), ("$plate", seed.Plate),
                ("$normalized", SqliteHelpers.NormalizePlate(seed.Plate)), ("$driver", seed.Driver),
                ("$phone", seed.Phone), ("$client", seed.Client), ("$material", seed.Material),
                ("$now", now));
        }
    }
#endif
}
