'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  Scale, 
  Activity, 
  FileText, 
  Truck, 
  HardDriveDownload, 
  LogOut, 
  Clock,
  Radio,
  User
} from 'lucide-react';
import { useEffect, useState } from 'react';

export function DashboardHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        new Intl.DateTimeFormat('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
          timeZone: 'Asia/Dhaka',
        }).format(now)
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  const navItems = [
    { href: '/dashboard', label: 'Monitor', icon: Activity },
    { href: '/dashboard/tickets', label: 'Tickets Ledger', icon: FileText },
    { href: '/dashboard/fleet', label: 'Fleet Registry', icon: Truck },
    { href: '/dashboard/backup', label: 'Backup & Restore', icon: HardDriveDownload },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/8 bg-[#090c13]/80 backdrop-blur-2xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand & Scale Telemetry Badge */}
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-slate-950 font-bold shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-white">
                  AUGMENT SCALE
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono tracking-tight">
                Main Yard • Weighbridge 1
              </p>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 pl-4 border-l border-white/8">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    isActive
                      ? 'bg-white/10 text-white shadow-sm border border-white/10'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Info & Profile Actions */}
        <div className="flex items-center gap-3">
          {/* Realtime Dhaka Clock */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-900/60 border border-white/5 text-slate-300 font-mono text-xs num-tabular">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{time || '--:--:--'}</span>
            <span className="text-[10px] text-slate-500 font-sans">Dhaka</span>
          </div>

          {/* Operator Badge */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/8">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 flex items-center justify-center text-[11px] font-bold">
              MR
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-semibold text-slate-200 leading-none">
                MD. RAJU
              </div>
              <div className="text-[10px] text-slate-400 font-medium leading-none mt-0.5">
                Supervisor
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-1"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
