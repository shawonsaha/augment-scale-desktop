'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export type RefreshMode = 'realtime' | '10s' | '30s' | '60s' | 'off';
export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'paused';

export interface RecentEventNotification {
  id: string;
  message: string;
  type: 'ticket' | 'workstation' | 'print' | 'system';
  timestamp: number;
}

interface RealtimeContextType {
  status: ConnectionStatus;
  mode: RefreshMode;
  setMode: (mode: RefreshMode) => void;
  isRefreshing: boolean;
  lastRefreshedAt: Date;
  refreshNow: () => void;
  recentNotification: RecentEventNotification | null;
  clearNotification: () => void;
  secondsSinceRefresh: number;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

const STORAGE_KEY = 'augment_scale_refresh_mode';

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [mode, setModeState] = useState<RefreshMode>('realtime');
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(() => new Date());
  const [secondsSinceRefresh, setSecondsSinceRefresh] = useState<number>(0);
  const [recentNotification, setRecentNotification] = useState<RecentEventNotification | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const notifTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Restore saved mode preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as RefreshMode | null;
      if (saved && ['realtime', '10s', '30s', '60s', 'off'].includes(saved)) {
        setModeState(saved);
      }
    } catch {
      // Ignore localStorage errors (e.g. private browsing)
    }
  }, []);

  const setMode = useCallback((newMode: RefreshMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // Ignore
    }
  }, []);

  // Central trigger to refresh Server Component data
  const refreshNow = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
    setLastRefreshedAt(new Date());
    setSecondsSinceRefresh(0);
  }, [router]);

  const showNotification = useCallback((message: string, type: RecentEventNotification['type']) => {
    const item: RecentEventNotification = {
      id: Math.random().toString(36).substring(2, 9),
      message,
      type,
      timestamp: Date.now(),
    };
    setRecentNotification(item);
    if (notifTimeoutRef.current) clearTimeout(notifTimeoutRef.current);
    notifTimeoutRef.current = setTimeout(() => {
      setRecentNotification((curr) => (curr?.id === item.id ? null : curr));
    }, 4500);
  }, []);

  const clearNotification = useCallback(() => {
    setRecentNotification(null);
  }, []);

  // Keep seconds elapsed updated every second
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsSinceRefresh((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Supabase Realtime Channel Subscription
  useEffect(() => {
    if (mode === 'off') {
      setStatus('paused');
      return;
    }

    const supabase = createClient();
    setStatus('connecting');

    const channel = supabase.channel('realtime:scale-live-feed', {
      config: {
        broadcast: { self: false },
      },
    });

    const triggerDebouncedRefresh = (msg: string, type: RecentEventNotification['type']) => {
      showNotification(msg, type);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        refreshNow();
      }, 400);
    };

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'weigh_tickets' },
        (payload: any) => {
          const newRow = payload.new;
          const eventType = payload.eventType;
          let msg = 'Scale ticket updated';
          if (newRow?.ticket_number) {
            if (eventType === 'INSERT') {
              msg = `⚡ New Ticket #${newRow.ticket_number} captured (${newRow.plate_number || 'Truck'})`;
            } else if (newRow.status === 'completed') {
              msg = `✅ Ticket #${newRow.ticket_number} completed (Net: ${(newRow.net_weight_kg || 0).toLocaleString()} kg)`;
            } else if (newRow.is_overridden) {
              msg = `⚠️ Ticket #${newRow.ticket_number} overridden by operator`;
            } else {
              msg = `🔄 Ticket #${newRow.ticket_number} updated`;
            }
          }
          triggerDebouncedRefresh(msg, 'ticket');
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workstations' },
        () => {
          triggerDebouncedRefresh('Workstation telemetry synchronized', 'workstation');
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'print_jobs' },
        (payload: any) => {
          const newRow = payload.new;
          triggerDebouncedRefresh(
            `🖨️ Ticket print copy #${newRow?.copy_number || 1} generated`,
            'print'
          );
        }
      )
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          setStatus('connected');
        } else if (
          subscriptionStatus === 'TIMED_OUT' ||
          subscriptionStatus === 'CHANNEL_ERROR'
        ) {
          setStatus('reconnecting');
        } else if (subscriptionStatus === 'CLOSED') {
          setStatus('disconnected');
        }
      });

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [mode, refreshNow, showNotification]);

  // Periodic Safety Interval Polling
  useEffect(() => {
    if (mode === 'off') return;

    let intervalMs = 0;
    if (mode === '10s') intervalMs = 10000;
    else if (mode === '30s') intervalMs = 30000;
    else if (mode === '60s') intervalMs = 60000;
    else if (mode === 'realtime') intervalMs = 45000; // 45s safety heartbeat poll

    if (intervalMs <= 0) return;

    const timer = setInterval(() => {
      refreshNow();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [mode, refreshNow]);

  // Refresh when user returns to the tab after being away
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mode !== 'off') {
        const elapsedMs = Date.now() - lastRefreshedAt.getTime();
        // If away for more than 12 seconds, trigger a silent catchup refresh
        if (elapsedMs > 12000) {
          refreshNow();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [lastRefreshedAt, mode, refreshNow]);

  return (
    <RealtimeContext.Provider
      value={{
        status,
        mode,
        setMode,
        isRefreshing: isPending,
        lastRefreshedAt,
        refreshNow,
        recentNotification,
        clearNotification,
        secondsSinceRefresh,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
}
