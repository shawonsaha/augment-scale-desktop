"""Export the SQLCipher-encrypted Augment Scale database to an unencrypted SQLite file."""

import os
import sys
import sqlite3
import subprocess
import sqlcipher3

def get_database_key():
    """Retrieve the database key using tools/Get-DbKey.ps1 via DPAPI."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ps_script = os.path.join(script_dir, "Get-DbKey.ps1")
    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps_script,
        "-ShowKey",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    # The key is output on stdout as a 44-character Base64 string
    lines = [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("No output received from Get-DbKey.ps1")
    key = lines[-1]
    if len(key) != 44:
        raise ValueError(f"Invalid key length ({len(key)} chars): '{key}'")
    return key

def export_unencrypted(source_path, target_path, key):
    if not os.path.isfile(source_path):
        raise FileNotFoundError(f"Source database not found: {source_path}")

    if os.path.exists(target_path):
        os.remove(target_path)

    print(f"Opening encrypted database: {source_path}")
    source_conn = sqlcipher3.connect(source_path)
    try:
        escaped_key = key.replace("'", "''")
        escaped_target = target_path.replace("'", "''")

        source_conn.execute(f"PRAGMA key = '{escaped_key}';")
        # Validate that the key works
        test_cnt = source_conn.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table';"
        ).fetchone()[0]
        print(f"Authenticated successfully. Source tables count: {test_cnt}")

        print(f"Exporting to unencrypted file: {target_path}")
        source_conn.execute(f"ATTACH DATABASE '{escaped_target}' AS plaintext KEY '';")
        source_conn.execute("SELECT sqlcipher_export('plaintext');")
        source_conn.execute("DETACH DATABASE plaintext;")
        print("Export completed successfully.")
    finally:
        source_conn.close()

def verify_unencrypted(target_path):
    print(f"\nVerifying unencrypted database with standard sqlite3: {target_path}")
    conn = sqlite3.connect(target_path)
    try:
        integrity = conn.execute("PRAGMA integrity_check;").fetchall()
        print(f"Integrity check: {integrity}")

        tables = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
            ).fetchall()
        ]
        print(f"Tables ({len(tables)}): {', '.join(tables)}")

        for t in ["weigh_tickets", "audit_events", "vehicles", "archive_runs"]:
            cnt = conn.execute(f"SELECT count(*) FROM {t};").fetchone()[0]
            print(f"  {t}: {cnt} rows")
    finally:
        conn.close()

    size = os.path.getsize(target_path)
    print(f"Target file size: {size:,} bytes ({size / 1024:.1f} KB)")

if __name__ == "__main__":
    local_app_data = os.environ.get("LOCALAPPDATA")
    user_profile = os.environ.get("USERPROFILE")

    source = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.path.join(local_app_data, "AugmentScale", "augment-scale.db")
    )
    target = (
        sys.argv[2]
        if len(sys.argv) > 2
        else os.path.join(user_profile, "Desktop", "augment-scale-plain-v2.db")
    )

    db_key = get_database_key()
    export_unencrypted(source, target, db_key)
    verify_unencrypted(target)
