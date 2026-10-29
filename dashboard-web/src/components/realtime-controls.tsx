'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRealtime, RefreshMode } from '@/lib/context/realtime-context';
import { 
  RefreshCw, 
  Clock, 
  ChevronDown, 
  Check, 
  PauseCircle, 
  Zap,
  X,
  Bell
} from 'lucide-react';

const MODE_OPTIONS: { id: RefreshMode; label: string; desc: string; icon: any }[] = [
  { id: 'realtime', label: 'Realtime (Instant)', desc: 'Instant WebSocket push updates', icon: Zap },
  { id: '10s', label: 'Every 10 seconds', desc: 'Active polling for high-traffic scales', icon: Clock },
  { id: '30s', label: 'Every 30 seconds', desc: 'Standard control-room interval', icon: Clock },
  { id: '60s', label: 'Every 1 minute', desc: 'Low bandwidth interval', icon: Clock },
  { id: 'off', label: 'Paused', desc: 'Manual refresh only', icon: PauseCircle },
];

export function RealtimeControls() {
  const {
    status,
    mode,
    setMode,
    isRefreshing,
    refreshNow,
    secondsSinceRefresh,
    recentNotification,
    clearNotification,
  } = useRealtime();

  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatElapsed = (sec: number) => {
    if (sec < 5) return 'Just now';
    if (sec < 60) return `${sec}s ago`;
    const m = Math.floor(sec / 60);
    return `${m}m ago`;
  };

  const getStatusBadge = () => {
    if (mode === 'off') {
      return {
        dotClass: 'bg-amber-400',
        textClass: 'text-amber-300 border-amber-500/20 bg-amber-500/10',
        label: 'PAUSED',
        pulse: false,
      };
    }

    if (status === 'connected') {
      if (mode === 'realtime') {
        return {
          dotClass: 'bg-emerald-400',
          textClass: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10',
          label: 'LIVE REALTIME',
          pulse: true,
        };
      }
      return {
        dotClass: 'bg-sky-400',
        textClass: 'text-sky-300 border-sky-500/20 bg-sky-500/10',
        label: `AUTO (${mode.toUpperCase()})`,
        pulse: true,
      };
    }

    if (status === 'connecting' || status === 'reconnecting') {
      return {
        dotClass: 'bg-yellow-400',
        textClass: 'text-yellow-300 border-yellow-500/20 bg-yellow-500/10',
        label: 'RECONNECTING',
        pulse: true,
      };
    }

    return {
      dotClass: 'bg-rose-400',
      textClass: 'text-rose-300 border-rose-500/20 bg-rose-500/10',
      label: 'OFFLINE',
      pulse: false,
    };
  };

  const badge = getStatusBadge();

  return (
    <>
      <div className="flex items-center gap-2" ref={menuRef}>
        {/* Realtime Status Badge & Mode Dropdown Trigger */}
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all hover:brightness-110 ${badge.textClass}`}
            title="Click to change live update cadence"
          >
            <span className="flex h-2 w-2 relative">
              {badge.pulse && (
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${badge.dotClass}`}
                />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${badge.dotClass}`} />
            </span>
            <span className="text-[11px] font-mono tracking-tight">{badge.label}</span>
            <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
          </button>

          {/* Mode Dropdown Menu */}
          {isOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-slate-900/95 border border-white/10 shadow-2xl backdrop-blur-2xl z-50 p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-2.5 py-1.5 border-b border-white/5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Data Refresh Mode
                </p>
                <p className="text-[11px] text-slate-500">
                  Weighbridge auto-sync configuration
                </p>
              </div>

              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = mode === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setMode(opt.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-start gap-2.5 p-2 rounded-xl text-left transition-colors ${
                      isSelected
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-white'
                        : 'hover:bg-white/5 text-slate-300'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isSelected ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}

              <div className="pt-1.5 border-t border-white/5 px-2 text-[10px] text-slate-500 flex items-center justify-between">
                <span>Tab focus sync: Enabled</span>
                <span className="text-emerald-400 font-mono">WebSockets</span>
              </div>
            </div>
          )}
        </div>

        {/* Manual Refresh Button with Live Spin & Elapsed Time */}
        <button
          onClick={refreshNow}
          disabled={isRefreshing}
          title={`Click to refresh data now. Last synced: ${formatElapsed(secondsSinceRefresh)}`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900/80 hover:bg-white/10 active:scale-95 border border-white/10 text-slate-300 hover:text-white transition-all text-xs font-medium"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          <span className="hidden sm:inline text-[11px] text-slate-400 font-mono num-tabular">
            {isRefreshing ? 'Syncing...' : formatElapsed(secondsSinceRefresh)}
          </span>
        </button>
      </div>

      {/* Floating Live Activity Toast: Teleported to document.body to avoid header backdrop-filter clipping.
          Positioned top on mobile (top-4 left-4 right-4), bottom-right on desktop (sm:bottom-6 sm:right-6 sm:top-auto sm:left-auto) */}
      {mounted && recentNotification && createPortal(
        <div
          role="status"
          aria-live="polite"
          className="fixed z-[9999] pointer-events-auto transition-all duration-300 ease-out
            top-4 left-4 right-4 max-w-md mx-auto
            sm:top-auto sm:left-auto sm:bottom-6 sm:right-6 sm:mx-0 sm:w-full sm:max-w-md animate-in fade-in slide-in-from-top-4 sm:slide-in-from-bottom-4"
        >
          <div className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl bg-slate-950/95 border border-emerald-500/50 shadow-2xl shadow-black/80 backdrop-blur-2xl text-white">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Bell className="w-4 h-4 animate-bounce" />
            </div>
            <div className="flex-1 min-w-0 pr-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                <span>Scale Event Detected</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-100 font-medium line-clamp-2 mt-0.5 leading-snug">
                {recentNotification.message}
              </p>
            </div>
            <button
              onClick={clearNotification}
              title="Dismiss notification"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
