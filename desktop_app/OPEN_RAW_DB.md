# Opening the Raw Augment Scale Database

This document explains where Augment Scale stores its database, how that database is
encrypted, and how to open it directly for inspection or support work.

The database is **SQLCipher-encrypted**. It cannot be opened with a normal SQLite
viewer, a text editor, or the standard `sqlite3` command unless the correct key is
supplied. The key is stored separately from the database and is protected by Windows
DPAPI.

> **Read-only first.** The application writes tickets, weight captures, audit events,
> outbox events, and print jobs in transactions. Editing the raw database bypasses
> those rules and can corrupt the audit trail. Open a copy, or use read-only mode,
> unless you have a specific recovery task and a backup.

---

## Contents

1. [What the raw database is](#1-what-the-raw-database-is)
2. [File locations](#2-file-locations)
3. [How the database is encrypted](#3-how-the-database-is-encrypted)
4. [Before you open it](#4-before-you-open-it)
5. [Quick start](#5-quick-start)
6. [Extract the database key](#6-extract-the-database-key)
7. [Option A: DB Browser for SQLCipher](#7-option-a-db-browser-for-sqlcipher)
8. [Option B: SQLCipher CLI](#8-option-b-sqlcipher-cli)
9. [Option C: Python sqlcipher3](#9-option-c-python-sqlcipher3)
10. [Create a plaintext copy](#10-create-a-plaintext-copy)
11. [Verify that you opened the right database](#11-verify-that-you-opened-the-right-database)
12. [Troubleshooting](#12-troubleshooting)
13. [Security and operational warnings](#13-security-and-operational-warnings)
14. [Quick reference](#14-quick-reference)

---

## 1. What the raw database is

The raw database is the file written by the desktop application:

```text
augment-scale.db
```

It is a SQLite database encrypted with SQLCipher. The application uses
`Microsoft.Data.Sqlite` together with `SQLitePCLRaw.bundle_e_sqlcipher`
(`AugmentScale/AugmentScale.csproj:25-26`) and supplies a random key through
`SqliteConnectionStringBuilder.Password` (`AugmentScale/Services/DatabaseService.cs:77-91`).

The file header is encrypted, so the first bytes do **not** contain the usual
`SQLite format 3` signature. That is expected. A raw hex dump or a normal SQLite
browser will report "file is not a database" until the key is provided.

---

## 2. File locations

### Default production location

| Item | Default path | Source |
|---|---|---|
| Data directory | `%LOCALAPPDATA%\AugmentScale` | `ConfigService.cs:33-40` |
| Encrypted database | `%LOCALAPPDATA%\AugmentScale\augment-scale.db` | `ConfigService.cs:49` |
| Protected secrets (contains the DB key) | `%LOCALAPPDATA%\AugmentScale\secrets.dat` | `ConfigService.cs:43` |
| Configuration | `%LOCALAPPDATA%\AugmentScale\setup.json` | `ConfigService.cs:42` |
| Logs | `%LOCALAPPDATA%\AugmentScale\logs\app-YYYYMMDD.log` | `ConfigService.cs:51` |
| WebView2 cache | `%LOCALAPPDATA%\AugmentScale\WebView2` | `ConfigService.cs:50` |

`%LOCALAPPDATA%` normally expands to `C:\Users\<user>\AppData\Local`.

On this workstation both the default location and the development location may exist.
Check which one was written most recently before opening anything:

```powershell
Get-Item `
  (Join-Path $env:LOCALAPPDATA 'AugmentScale\augment-scale.db'), `
  (Join-Path $env:TEMP 'augment-scale-dev\augment-scale.db') `
  -ErrorAction SilentlyContinue |
    Select-Object FullName, Length, LastWriteTime
```

The default production database on this workstation is:

```text
C:\Users\Shawon\AppData\Local\AugmentScale\augment-scale.db
```

### Isolated or development data directory

`ConfigService` honors the `AUGMENTSCALE_DATA_DIR` environment variable if it is set
(`ConfigService.cs:33-40`). When set, **all** of the files above live in that directory
instead.

The development launcher sets it to a temporary directory:

```text
%TEMP%\augment-scale-dev
```

See `start-dev-sim.ps1:3` and `start-dev-sim.ps1:65`. The variable is set only inside
the launcher process and the processes it starts; launching the app manually after the
launcher exits normally returns to `%LOCALAPPDATA%\AugmentScale`.

To work with the development database, pass that directory explicitly:

```powershell
.\tools\Get-DbKey.ps1 -DataDir (Join-Path $env:TEMP 'augment-scale-dev')
```

### Running the simulator against the live database

The launcher defaults to the isolated directory. To use the simulator while writing to the default live database:

```powershell
.\start-dev-sim.ps1 -UseProductionData
```

This selects `%LOCALAPPDATA%\AugmentScale`, temporarily sets
`scaleConnection.portName` to `TCP:127.0.0.1:9876`, and starts the simulator and
application. When the application exits, the launcher restores the previous
`portName` (normally `COM1`), so the next normal launch does not connect to the
simulator. If the launcher is forcibly terminated, restore `portName` manually or
from the backup. The database itself is not restored: vehicles, tickets, audit
events, and outbox events written during the run are real. The
`scale_connection_profiles` row remains on the simulator transport until the next
normal launch re-provisions it from the restored `setup.json`.

To create a timestamped backup before the run:

```powershell
.\start-dev-sim.ps1 -UseProductionData -BackupDatabase
```

Backups are written to `%LOCALAPPDATA%\AugmentScale\backups\<timestamp>\` and
include `augment-scale.db`, `secrets.dat`, `setup.json`, `simulator.json`, and any
`-wal` or `-shm` files that exist.

The application window title shows `Augment Scale — TEST DATA` whenever the
resolved data directory is not `%LOCALAPPDATA%\AugmentScale`. A live run keeps the
normal `Augment Scale` title.

### Legacy files

`%LOCALAPPDATA%\AugmentScale\local.db` and `local.key` are not referenced by the
current application code and appear to be leftovers from an earlier prototype or the
removed built-in web frontend. The current application only uses
`augment-scale.db` and `secrets.dat`. Do not confuse `local.db` with the live database.

---

## 3. How the database is encrypted

- The application generates a random 32-byte key on first run and stores it
  Base64-encoded in the `databaseKey` property of `secrets.dat`
  (`ConfigService.cs:194`).
- `secrets.dat` is protected with Windows DPAPI in **CurrentUser** scope using the
  application entropy `AugmentScale.Secrets.v1` (`ConfigService.cs:17`,
  `ConfigService.cs:173`, `ConfigService.cs:236`).
- The database itself is SQLCipher 4.x with SQLCipher 4 defaults:
  - Cipher: AES-256-CBC
  - Page size: 4096 bytes
  - KDF: PBKDF2-HMAC-SHA512, 256000 iterations
  - HMAC: HMAC-SHA512
- The 44-character Base64 string in `secrets.dat` is used as a **text passphrase**.
  It is not a hexadecimal raw key.
- The same `secrets.dat` also contains the operator PIN hashes. PINs themselves are
  not stored there in plaintext.

Consequences:

- `secrets.dat` can only be decrypted by the same Windows user on the same Windows
  installation.
- Copying `secrets.dat` to another user account or another computer will not work.
- If `secrets.dat` is deleted or replaced, the application creates a new key and the
  existing `augment-scale.db` becomes unreadable.
- The database and `secrets.dat` are a matched pair. Back them up together.

---

## 4. Before you open it

1. **Close Augment Scale.** The application may hold a write lock or have uncommitted
   state.
2. **Back up the pair together** while the application is closed:
   - `augment-scale.db`
   - `secrets.dat`
3. If you only need to inspect data, work on a **copy** of the database. For a
   consistent copy, close the app first. If the app must stay open, copy
   `augment-scale.db` plus any adjacent `-wal`, `-shm`, or `-journal` files.
4. Do not delete, regenerate, or edit `secrets.dat`.
5. Never commit the database, `secrets.dat`, the extracted key, or a plaintext export
   to source control.

Backup example:

```powershell
$source = Join-Path $env:LOCALAPPDATA 'AugmentScale'
$backup = Join-Path $env:USERPROFILE 'Desktop\AugmentScale-backup'
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'augment-scale.db') -Destination $backup
Copy-Item -LiteralPath (Join-Path $source 'secrets.dat') -Destination $backup
```

---

## 5. Quick start

From the `desktop_app` directory:

```powershell
# 1. Extract the key; by default it is copied to the clipboard.
powershell -ExecutionPolicy Bypass -File .\tools\Get-DbKey.ps1

# 2. Install DB Browser for SQLite from https://sqlitebrowser.org/dl/

# 3. Launch "DB Browser for SQLCipher", not "DB Browser for SQLite".

# 4. Open the database, choose "SQLCipher 4 defaults", and paste the key.
```

If the execution policy prevents the script from running, the
`-ExecutionPolicy Bypass` shown above applies only to that one invocation.

The rest of this document explains each step and the alternative tools.

---

## 6. Extract the database key

### Option 6.1: Helper script (recommended)

`tools/Get-DbKey.ps1` reads `secrets.dat` with DPAPI, extracts `databaseKey`, and
copies it to the clipboard. It does not modify the database or the secrets file.

```powershell
# Default data directory: %LOCALAPPDATA%\AugmentScale
.\tools\Get-DbKey.ps1

# Explicit data directory (for example, the development launcher)
.\tools\Get-DbKey.ps1 -DataDir (Join-Path $env:TEMP 'augment-scale-dev')

# Print the key instead of copying it (use with care)
.\tools\Get-DbKey.ps1 -ShowKey
```

The script also honors `AUGMENTSCALE_DATA_DIR` when `-DataDir` is omitted.

Clear the clipboard when you are done:

```powershell
cmd /c "echo off | clip"
```

### Option 6.2: Manual extraction

Run this in Windows PowerShell 5.1 (or PowerShell 7 after loading the assembly as noted
below) on the **same Windows account** that runs Augment Scale:

```powershell
Add-Type -AssemblyName System.Security

$dataDir = Join-Path $env:LOCALAPPDATA 'AugmentScale'
$secretsPath = Join-Path $dataDir 'secrets.dat'
$entropy = [Text.Encoding]::UTF8.GetBytes('AugmentScale.Secrets.v1')

$protectedBytes = [IO.File]::ReadAllBytes($secretsPath)
$plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
)

$secrets = [Text.Encoding]::UTF8.GetString($plainBytes) | ConvertFrom-Json
$key = $secrets.databaseKey

# Copy instead of printing if the terminal is being recorded.
$key | Set-Clipboard

# Verify the expected shape without displaying the key.
"Key length: $($key.Length) characters"
```

The expected key length is 44 characters because it is Base64 for 32 random bytes.

The helper script is written for Windows PowerShell 5.1. If PowerShell 7 cannot find
the `ProtectedData` type, run the script with Windows PowerShell 5.1, or load the
assembly explicitly in PowerShell 7:

```powershell
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
```

### Key formats

Use the Base64 string as the **passphrase** in GUI tools and in `PRAGMA key`:

```sql
PRAGMA key = 'BASE64_KEY_HERE';
```

If a tool explicitly requires a raw key, convert the Base64 value to hex:

```powershell
$raw = [Convert]::FromBase64String($key)
$hex = ($raw | ForEach-Object { $_.ToString('x2') }) -join ''
$hex
```

Then use SQLCipher's raw-key syntax (note the double quotes around `x'...'`):

```sql
PRAGMA key = "x'HEX_KEY_HERE'";
```

Most tools, including DB Browser for SQLCipher, accept the Base64 text passphrase.
Prefer that unless the tool asks specifically for a raw key.

---

## 7. Option A: DB Browser for SQLCipher

The DB Browser for SQLite installer is the easiest GUI option, but it installs **two**
programs on Windows:

| Executable | Purpose |
|---|---|
| `DB Browser for SQLite.exe` | Plain unencrypted SQLite only |
| `DB Browser for SQLCipher.exe` | SQLite **and** SQLCipher-encrypted databases |

You must launch **DB Browser for SQLCipher.exe**. If you launch the plain SQLite build
on `augment-scale.db`, it reports `file is not a database`.

In the Windows Start Menu these appear as:

- **DB Browser (SQLCipher)**
- **DB Browser (SQLite)**

### Install

Download and install from:

```text
https://sqlitebrowser.org/dl/
```

Use a current official build that includes SQLCipher support and exposes the
"SQLCipher 4 defaults" preset. The official Windows installer from sqlitebrowser.org
places the SQLCipher build at:

```text
C:\Program Files\DB Browser for SQLite\DB Browser for SQLCipher.exe
```

### Open the database

1. Close Augment Scale.
2. Start **DB Browser for SQLCipher** (not the plain SQLite executable).
3. Choose **File > Open Database** (or **Open Database Read-Only** if your build offers
   it) and select:
   ```text
   %LOCALAPPDATA%\AugmentScale\augment-scale.db
   ```
4. When the encryption dialog appears:
   - Choose **SQLCipher 4 defaults**.
   - Leave the cipher settings at their SQLCipher 4 values:
     AES-256-CBC, page size 4096, KDF iterations 256000, HMAC-SHA512.
   - Paste the Base64 key into the **Password** field.
   - Leave **Raw key** unchecked. The Base64 value is a text passphrase, not a hex key.
5. Click **OK**. The tables should appear in the **Database Structure** tab.

If the dialog is not shown automatically, close the database and use **File > Open
Database** again; encrypted files should trigger the password/encryption prompt. If
your build exposes encryption settings elsewhere, apply the same values listed above.

### Useful tables

| Table | Contents |
|---|---|
| `schema_version` | Applied migration versions |
| `weigh_tickets` | Ticket header, weights, status, vehicle, customer, driver |
| `weight_captures` | Individual scale readings and stability data |
| `print_jobs` | Print and reprint history |
| `audit_events` | Audit trail and hash chain fields |
| `outbox_events` | Pending synchronization events |
| `vehicles`, `customers`, `drivers`, `products` | Master data |
| `profiles`, `user_roles` | Operators and roles |
| `organizations`, `sites`, `weighbridges`, `workstations` | Installation metadata |
| `scale_connection_profiles` | Scale serial/TCP configuration history |
| `scale_health_events` | Scale connection health events |
| `ticket_corrections`, `sync_cursors`, `offline_leases` | Corrections and sync state |

### Important

- Do **not** click **Write Changes** unless you intend to modify the live database.
  Opening read-only prevents accidental edits.
- The application does not know about edits made directly to the file. Direct changes
  bypass audit, outbox, and print-record logic.

---

## 8. Option B: SQLCipher CLI

Use a `sqlcipher` command-line build, not the standard `sqlite3` binary. The standard
SQLite CLI does not understand SQLCipher encryption.

You can obtain a SQLCipher CLI by building it from the SQLCipher source
(https://github.com/sqlcipher/sqlcipher), using a trusted prebuilt package, or by using
the Python package described in the next section if you do not want to build one.

### Interactive session

```powershell
sqlcipher "$env:LOCALAPPDATA\AugmentScale\augment-scale.db"
```

Inside the shell, set the key **before any other statement**:

```sql
PRAGMA key = 'BASE64_KEY_HERE';
```

Then inspect the database:

```sql
.tables
.schema weigh_tickets
.headers on
.mode box
SELECT * FROM schema_version;
SELECT ticket_number, ticket_display_id, status, plate_number,
       first_weight_kg, second_weight_kg, net_weight_kg, created_at
FROM weigh_tickets
ORDER BY ticket_number DESC
LIMIT 20;
.quit
```

If you need the raw key form:

```sql
PRAGMA key = "x'HEX_KEY_HERE'";
```

### Notes

- `PRAGMA key` must be the first operation on the connection.
- The Base64 key is case-sensitive and must be complete.
- Do not put the key directly in a shell command that is recorded in history or process
  listings. Prefer the interactive prompt.
- If the database was created by an older SQLCipher 3 build, set compatibility before
  the key:
  ```sql
  PRAGMA cipher_compatibility = 3;
  PRAGMA key = 'BASE64_KEY_HERE';
  ```
  Databases created by the current application use SQLCipher 4 defaults, so this is
  normally unnecessary.

---

## 9. Option C: Python sqlcipher3

The `sqlcipher3` package bundles a SQLCipher-enabled SQLite build and is convenient for
scripted inspection.

### Install

```powershell
py -m pip install sqlcipher3
```

### Read the database

```python
import getpass
import sqlcipher3

DB_PATH = r"C:\Users\Shawon\AppData\Local\AugmentScale\augment-scale.db"
KEY = getpass.getpass("Paste database key: ")

connection = sqlcipher3.connect(DB_PATH)
try:
    escaped = KEY.replace("'", "''")
    connection.execute(f"PRAGMA key = '{escaped}'")

    tables = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).fetchall()
    print([row[0] for row in tables])

    print("tickets:", connection.execute(
        "SELECT COUNT(*) FROM weigh_tickets"
    ).fetchone()[0])

    for row in connection.execute(
        "SELECT ticket_number, status, plate_number, net_weight_kg, created_at "
        "FROM weigh_tickets ORDER BY ticket_number DESC LIMIT 10"
    ):
        print(row)
finally:
    connection.close()
```

Replace `DB_PATH` with the actual database path, including the development directory if
applicable. If the key is wrong, the first query raises a "file is not a database" or
HMAC error.

### Read-only analysis

To reduce the chance of accidental writes, close Augment Scale and open a copy:

```powershell
Copy-Item `
  -LiteralPath (Join-Path $env:LOCALAPPDATA 'AugmentScale\augment-scale.db') `
  -Destination (Join-Path $env:TEMP 'augment-scale-copy.db')
```

Then point `DB_PATH` in the Python snippet at `augment-scale-copy.db`. Use the same key;
the copy is encrypted exactly like the original. Delete the copy when finished.

---

## 10. Create a plaintext copy

For analysis, it is often safer to decrypt a **copy** and leave the live database
untouched. Close Augment Scale first, then produce the copy. The result is an ordinary
unencrypted SQLite database that any SQLite tool can open.

### With the SQLCipher CLI

```powershell
sqlcipher "$env:LOCALAPPDATA\AugmentScale\augment-scale.db"
```

```sql
PRAGMA key = 'BASE64_KEY_HERE';
ATTACH DATABASE 'C:\path\to\augment-scale-plain.db' AS plaintext KEY '';
SELECT sqlcipher_export('plaintext');
DETACH DATABASE plaintext;
.quit
```

- `KEY ''` makes the attached database unencrypted.
- The target file must not already exist; remove an old export first.
- Do not run this against a database you have not backed up.
- After export, open `augment-scale-plain.db` with either DB Browser executable or
  `sqlite3`; the export is no longer encrypted.

### With Python

```python
import getpass
import os
import sqlcipher3

SOURCE = r"C:\Users\Shawon\AppData\Local\AugmentScale\augment-scale.db"
TARGET = r"C:\path\to\augment-scale-plain.db"
KEY = getpass.getpass("Paste database key: ")

if os.path.exists(TARGET):
    raise SystemExit("Target already exists; choose another path or remove it first.")

connection = sqlcipher3.connect(SOURCE)
try:
    escaped_key = KEY.replace("'", "''")
    escaped_target = TARGET.replace("'", "''")
    connection.execute(f"PRAGMA key = '{escaped_key}'")
    connection.execute(
        f"ATTACH DATABASE '{escaped_target}' AS plaintext KEY ''"
    )
    connection.execute("SELECT sqlcipher_export('plaintext')")
    connection.execute("DETACH DATABASE plaintext")
finally:
    connection.close()
```

Delete the plaintext copy when finished:

```powershell
Remove-Item -LiteralPath 'C:\path\to\augment-scale-plain.db'
```

A plaintext copy has no encryption or DPAPI protection. Treat it like the live database
and do not leave it on shared storage.

---

## 11. Verify that you opened the right database

Run:

```sql
SELECT * FROM schema_version;
```

Expected result for the current version:

| version | name |
|---|---|
| 1 | InitialSchema |

List the tables:

```sql
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
```

Expected tables:

```text
audit_events
customers
drivers
offline_leases
organizations
outbox_events
print_jobs
products
profiles
scale_connection_profiles
scale_health_events
schema_version
sites
sync_cursors
ticket_corrections
user_roles
vehicles
weigh_tickets
weighbridges
weight_captures
workstations
```

If the schema looks empty, wrong, or like a freshly created database, **do not write to
it**. Close without saving and re-check the path, key, and SQLCipher settings.

`start-dev-sim.ps1` prints the selected database path before launching. If a row
you added is missing from `%LOCALAPPDATA%\AugmentScale\augment-scale.db`, check
whether the app was started with `-UseProductionData` or is still using
`%TEMP%\augment-scale-dev`.

Useful sample queries:

```sql
SELECT COUNT(*) FROM weigh_tickets;

SELECT ticket_number, ticket_display_id, direction, status, plate_number,
       first_weight_kg, second_weight_kg, net_weight_kg, created_at
FROM weigh_tickets
ORDER BY ticket_number DESC
LIMIT 20;

SELECT id, entity_type, entity_id, action, actor_display_name, created_at
FROM audit_events
ORDER BY created_at DESC
LIMIT 20;
```

---

## 12. Troubleshooting

### "file is not a database", "hmac check failed", or "file is encrypted or is not a database"

The key or encryption settings are wrong. Check, in order:

1. You are using the `secrets.dat` that belongs to this exact database. A new
   `secrets.dat` creates a new key and cannot open an older database.
2. You extracted the key as the same Windows user that runs the application. DPAPI
   CurrentUser blobs do not survive copying to another user or computer.
3. You pasted the full 44-character Base64 value, including any `+`, `/`, and `=`
   characters.
4. You used it as a text passphrase. Only enable a "raw key" option if you converted it
   to hex first.
5. You selected **SQLCipher 4 defaults** (AES-256-CBC, 4096-byte pages, 256000 KDF
   iterations, HMAC-SHA512).
6. If this database predates the current application version, try
   `PRAGMA cipher_compatibility = 3;` before setting the key.

### DB Browser says "file is not a database" and never asks for a password

You launched the plain SQLite build. Close it and start **DB Browser for SQLCipher**
instead. On a default Windows install, use the Start Menu shortcut
**DB Browser (SQLCipher)**, or run:

```text
C:\Program Files\DB Browser for SQLite\DB Browser for SQLCipher.exe
```

The plain `DB Browser for SQLite.exe` has no SQLCipher support, so it cannot decrypt
`augment-scale.db` and reports this error immediately. The SQLCipher build prompts for
the key and encryption settings.

### "database is locked" or "unable to open database file"

Close Augment Scale. If the file is still locked, copy the database and open the copy.
Do not delete journal files from the live directory. If a `-wal`, `-shm`, or `-journal`
file exists, include it when copying.

### The script cannot be loaded because running scripts is disabled

Run it for this invocation only:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\Get-DbKey.ps1
```

### `Unable to find type [Security.Cryptography.ProtectedData]`

Load the assembly first:

```powershell
Add-Type -AssemblyName System.Security
```

The manual extraction snippet in this document already includes that line. The helper
script also loads it.

### The key is found but DB Browser still refuses to open the file

Confirm you selected the actual `augment-scale.db`, not `local.db`, and that the
database file size is plausible. On this workstation the live database was 352 KB at
the time of writing. A zero-byte or tiny file is not the live database.

### The development database is missing

The development launcher uses:

```text
%TEMP%\augment-scale-dev\augment-scale.db
```

Pass that directory to the helper:

```powershell
.\tools\Get-DbKey.ps1 -DataDir (Join-Path $env:TEMP 'augment-scale-dev')
```

### The key cannot be decrypted on another machine

That is expected. `secrets.dat` is DPAPI-protected for the current Windows user and
machine. Restore it on the original machine under the original account. There is no
password recovery mechanism if the original `secrets.dat` is lost.

---

## 13. Security and operational warnings

- **The database key grants full access.** Anyone with the key and the database file can
  read all business and personal data in it.
- **Do not commit secrets.** Never commit `augment-scale.db`, `secrets.dat`, the
  extracted key, or a plaintext export to Git.
- **Clear the clipboard** after pasting the key.
- **Avoid command-line history exposure.** Do not paste the key directly into a command
  that is recorded in shell history or visible in process listings.
- **Do not edit `secrets.dat`.** It is a binary DPAPI blob, not JSON.
- **Do not regenerate `secrets.dat`** unless this is a brand-new install with no data
  that matters.
- **Direct writes bypass application rules.** The app writes audit events, outbox
  events, print jobs, hash chains, and ticket state together. Editing the file directly
  can leave those records inconsistent.
- **The database contains personal data** such as driver names and phone numbers. Store
  backups and plaintext exports on access-controlled media.
- **Direct access is not audited by the app.** Opening the database outside the
  application leaves no application audit event.

---

## 14. Quick reference

```powershell
# Where the files are
$data = Join-Path $env:LOCALAPPDATA 'AugmentScale'
Get-ChildItem -LiteralPath $data

# Run the simulator against the live database
.\start-dev-sim.ps1 -UseProductionData

# Run it with a pre-run backup
.\start-dev-sim.ps1 -UseProductionData -BackupDatabase

# Extract the key (copied to clipboard)
.\tools\Get-DbKey.ps1

# Extract the key for the development data directory
.\tools\Get-DbKey.ps1 -DataDir (Join-Path $env:TEMP 'augment-scale-dev')

# Print the key instead
.\tools\Get-DbKey.ps1 -ShowKey

# Clear the clipboard
cmd /c "echo off | clip"
```

```sql
-- In DB Browser for SQLCipher: SQLCipher 4 defaults + the Base64 key as password
-- In SQLCipher CLI or Python: set the key first
PRAGMA key = 'BASE64_KEY_HERE';

SELECT * FROM schema_version;
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
SELECT COUNT(*) FROM weigh_tickets;
```

---

## Source references

- `AugmentScale/Services/ConfigService.cs` - data directory, `secrets.dat`, DPAPI,
  key generation, database path.
- `AugmentScale/Services/DatabaseService.cs` - SQLCipher connection and schema
  migrations.
- `AugmentScale/AugmentScale.csproj` - `Microsoft.Data.Sqlite` and
  `SQLitePCLRaw.bundle_e_sqlcipher` package references.
- `AugmentScale/Data/Schema/V001_InitialSchema.sql` - table definitions.
- `start-dev-sim.ps1` - development data directory and simulator launcher.
- `USER_MANUAL.md` - data locations, backup rules, and operational guidance.
