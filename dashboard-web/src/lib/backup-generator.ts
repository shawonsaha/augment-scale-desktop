import { createClient } from '@/lib/supabase/server';
import initSqlJs from 'sql.js';
import path from 'path';

export async function fetchOperationalBackupData() {
  const supabase = await createClient();

  const [
    ticketsRes,
    vehiclesRes,
    correctionsRes,
    profilesRes,
    rolesRes,
    weighbridgesRes,
    workstationsRes,
  ] = await Promise.all([
    supabase.from('weigh_tickets').select('*').order('ticket_number', { ascending: true }),
    supabase.from('vehicles').select('*').order('plate_number', { ascending: true }),
    supabase.from('ticket_corrections').select('*').order('requested_at', { ascending: false }),
    supabase.from('profiles').select('*'),
    supabase.from('user_roles').select('*'),
    supabase.from('weighbridges').select('*'),
    supabase.from('workstations').select('*'),
  ]);

  return {
    metadata: {
      source: 'Augment Scale Web Cloud Hub',
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      exportedAt: new Date().toISOString(),
      counts: {
        weigh_tickets: ticketsRes.data?.length || 0,
        vehicles: vehiclesRes.data?.length || 0,
        ticket_corrections: correctionsRes.data?.length || 0,
        profiles: profilesRes.data?.length || 0,
        user_roles: rolesRes.data?.length || 0,
        weighbridges: weighbridgesRes.data?.length || 0,
        workstations: workstationsRes.data?.length || 0,
      },
    },
    tables: {
      weigh_tickets: ticketsRes.data || [],
      vehicles: vehiclesRes.data || [],
      ticket_corrections: correctionsRes.data || [],
      profiles: profilesRes.data || [],
      user_roles: rolesRes.data || [],
      weighbridges: weighbridgesRes.data || [],
      workstations: workstationsRes.data || [],
    },
  };
}

export function generateSqlScript(data: any): string {
  const lines: string[] = [];
  lines.push('-- =========================================================');
  lines.push('-- Augment Scale Cloud Database Restore Script');
  lines.push(`-- Exported At: ${data.metadata.exportedAt}`);
  lines.push('-- Compatible with Augment Scale Offline SQLite Store');
  lines.push('-- =========================================================');
  lines.push('PRAGMA foreign_keys = OFF;');
  lines.push('BEGIN TRANSACTION;');

  for (const [tableName, rows] of Object.entries(data.tables)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    lines.push(`\n-- Table: ${tableName} (${rows.length} rows)`);

    for (const row of rows) {
      const cols = Object.keys(row);
      const colNames = cols.map(c => `"${c}"`).join(', ');
      const values = cols.map(c => {
        const val = (row as any)[c];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return val.toString();
        if (typeof val === 'boolean') return val ? '1' : '0';
        if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
        return `'${String(val).replace(/'/g, "''")}'`;
      }).join(', ');

      lines.push(`INSERT OR REPLACE INTO ${tableName} (${colNames}) VALUES (${values});`);
    }
  }

  lines.push('\nCOMMIT;');
  lines.push('PRAGMA foreign_keys = ON;');
  return lines.join('\n');
}

export async function generateSqliteBinary(data: any): Promise<Uint8Array> {
  const wasmPath = path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });
  const db = new SQL.Database();

  // Create SQLite tables matching AugmentScale schema
  db.run(`
    CREATE TABLE IF NOT EXISTS weigh_tickets (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      weighbridge_id TEXT NOT NULL,
      workstation_id TEXT NOT NULL,
      ticket_number INTEGER NOT NULL,
      ticket_display_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      vehicle_id TEXT,
      plate_number TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT,
      customer_id TEXT,
      customer_name TEXT,
      driver_id TEXT,
      driver_name TEXT,
      driver_phone TEXT,
      challan TEXT,
      remarks TEXT,
      first_weight_kg REAL,
      first_weight_type TEXT,
      first_weight_at TEXT,
      first_weight_capture_id TEXT,
      first_operator_id TEXT,
      first_operator_name TEXT,
      second_weight_kg REAL,
      second_weight_type TEXT,
      second_weight_at TEXT,
      second_weight_capture_id TEXT,
      second_operator_id TEXT,
      second_operator_name TEXT,
      gross_weight_kg REAL,
      tare_weight_kg REAL,
      net_weight_kg REAL,
      is_overridden INTEGER NOT NULL DEFAULT 0,
      override_reason TEXT,
      override_operator_id TEXT,
      override_operator_name TEXT,
      override_anomaly_details TEXT,
      override_at TEXT,
      completed_at TEXT,
      voided_at TEXT,
      voided_by TEXT,
      voided_reason TEXT,
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT,
      deleted_by TEXT,
      deleted_reason TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      plate_number TEXT NOT NULL,
      plate_normalized TEXT NOT NULL,
      default_driver_name TEXT,
      default_driver_phone TEXT,
      default_client TEXT,
      default_material TEXT,
      notes TEXT,
      trip_count INTEGER NOT NULL DEFAULT 0,
      last_weighed_at TEXT,
      last_tare_kg REAL,
      registered_by TEXT,
      updated_by TEXT,
      row_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      deleted_by TEXT,
      deleted_reason TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_corrections (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      correction_type TEXT NOT NULL,
      field_changed TEXT,
      old_value TEXT,
      new_value TEXT,
      reason TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      approval_status TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      first_name TEXT,
      initials TEXT,
      avatar_url TEXT,
      color TEXT,
      shift TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      deleted_by TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      site_id TEXT,
      role TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      granted_by TEXT,
      revoked_at TEXT,
      revoked_by TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS weighbridges (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      max_capacity_kg INTEGER,
      min_division_kg INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      deleted_by TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workstations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      weighbridge_id TEXT NOT NULL,
      hostname TEXT,
      device_key_thumbprint TEXT,
      registered_at TEXT NOT NULL,
      last_seen_at TEXT,
      settings TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT
    );
  `);

  for (const [tableName, rows] of Object.entries(data.tables)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (const row of rows) {
      const keys = Object.keys(row);
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT OR REPLACE INTO ${tableName} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${placeholders});`;
      const values = keys.map(k => {
        const val = (row as any)[k];
        if (typeof val === 'boolean') return val ? 1 : 0;
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        return val;
      });
      try {
        db.run(sql, values);
      } catch (e) {
        // Continue
      }
    }
  }

  const binaryArray = db.export();
  db.close();
  return binaryArray;
}
