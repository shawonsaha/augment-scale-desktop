'use client';

import { useState } from 'react';
import { 
  HardDriveDownload, 
  FileJson, 
  Database, 
  FileCode, 
  Terminal, 
  Copy, 
  Check, 
  AlertTriangle, 
  Laptop, 
  ShieldCheck,
  ArrowRight
} from 'lucide-react';

export default function BackupPage() {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const restoreScript = `# ====================================================================
# Augment Scale — Offline Desktop Database Restore Tool
# Run in Windows PowerShell (Administrator or standard user)
# ====================================================================

$desktopAppDir = "$env:LOCALAPPDATA\AugmentScale"
$targetDb = Join-Path $desktopAppDir "augment-scale.db"
$backupDir = Join-Path $desktopAppDir "backups\pre-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

# 1. Ensure Augment Scale desktop application is closed
$runningProc = Get-Process -Name "AugmentScale" -ErrorAction SilentlyContinue
if ($runningProc) {
    Write-Host "Warning: Augment Scale is running. Please close the app first." -ForegroundColor Yellow
    exit 1
}

# 2. Create safety snapshot of current local database
if (Test-Path $targetDb) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Copy-Item -Path $targetDb -Destination $backupDir -Force
    Write-Host "Safety backup created at: $backupDir" -ForegroundColor Green
}

# 3. Import downloaded web cloud backup (Place augment-scale-cloud-backup.db in Downloads)
$downloadedBackup = Join-Path $env:USERPROFILE "Downloads\augment-scale-cloud-backup-*.db"
$latestFile = Get-ChildItem -Path $downloadedBackup -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $latestFile) {
    Write-Host "Downloaded backup not found in Downloads. Please download it from Web Dashboard first." -ForegroundColor Red
    exit 1
}

Write-Host "Restoring from: $($latestFile.FullName)..." -ForegroundColor Cyan
# Replace database file
Copy-Item -Path $latestFile.FullName -Destination $targetDb -Force
Write-Host "Database successfully restored into offline desktop app!" -ForegroundColor Green
Write-Host "You may now re-launch Augment Scale." -ForegroundColor Green
`;

  const copyScript = () => {
    navigator.clipboard.writeText(restoreScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (format: 'json' | 'sqlite' | 'sql') => {
    setDownloading(format);
    const link = document.createElement('a');
    link.href = `/api/backup?format=${format}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => setDownloading(null), 1500);
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white mb-1">
          Cloud Database Backup &amp; Offline Desktop Restore
        </h1>
        <p className="text-xs text-slate-400">
          Export verified weighbridge operational state from Supabase Cloud and restore seamlessly into the offline WPF desktop app.
        </p>
      </div>

      {/* 3 Download Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* JSON Export */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between border-white/10 hover:border-emerald-500/30 transition-all">
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4">
              <FileJson className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">
              JSON Snapshot
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Complete structured export containing tickets, vehicles, corrections, and profiles with metadata.
            </p>
          </div>
          <button
            onClick={() => handleDownload('json')}
            disabled={downloading !== null}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-500/10"
          >
            <HardDriveDownload className="w-4 h-4" />
            Download .json Backup
          </button>
        </div>

        {/* SQLite DB File */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between border-white/10 hover:border-cyan-500/30 transition-all relative overflow-hidden">
          <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            RECOMMENDED
          </div>
          <div>
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-4">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">
              SQLite Database (.db)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Compiled binary SQLite store ready for instant drop-in restore into the offline desktop workstation.
            </p>
          </div>
          <button
            onClick={() => handleDownload('sqlite')}
            disabled={downloading !== null}
            className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 active:scale-[0.98] text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-500/10"
          >
            <HardDriveDownload className="w-4 h-4" />
            Download .db File
          </button>
        </div>

        {/* SQL Script */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between border-white/10 hover:border-indigo-500/30 transition-all">
          <div>
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-4">
              <FileCode className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">
              SQL Migration (.sql)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Transactional INSERT statements compatible with any SQLite browser or command-line client.
            </p>
          </div>
          <button
            onClick={() => handleDownload('sql')}
            disabled={downloading !== null}
            className="w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 active:scale-[0.98] text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all border border-white/10"
          >
            <HardDriveDownload className="w-4 h-4" />
            Download .sql Script
          </button>
        </div>
      </div>

      {/* Restore Instructions & PowerShell Tool */}
      <div className="glass-panel p-6 rounded-3xl space-y-5 border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                How to Restore into Offline Desktop App
              </h2>
              <p className="text-xs text-slate-400">
                1-click automated PowerShell restoration script for workstation operator.
              </p>
            </div>
          </div>

          <button
            onClick={copyScript}
            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-slate-200 font-medium flex items-center gap-1.5 transition-colors border border-white/10"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copied Script!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy PowerShell Code
              </>
            )}
          </button>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/5 space-y-1.5">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[11px]">
              1
            </span>
            <h4 className="font-semibold text-slate-200">Download .db File</h4>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Click the "Download .db File" button above. The backup will save to your Downloads folder.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/5 space-y-1.5">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[11px]">
              2
            </span>
            <h4 className="font-semibold text-slate-200">Close Desktop App</h4>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Make sure the Augment Scale desktop application is closed so the database file is not locked.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/5 space-y-1.5">
            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[11px]">
              3
            </span>
            <h4 className="font-semibold text-slate-200">Run Restore Script</h4>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Open PowerShell, paste the script below, and press Enter. It automatically creates a safety copy and restores the database!
            </p>
          </div>
        </div>

        {/* Terminal Code Preview */}
        <div className="relative rounded-2xl bg-[#07090e] border border-white/10 p-4 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-64">
          <pre>{restoreScript}</pre>
        </div>
      </div>
    </div>
  );
}
