import { Radio, Laptop, ShieldCheck, Database } from 'lucide-react';
import { Workstation, Weighbridge } from '@/lib/types';
import { formatDate } from '@/lib/utils';

interface Props {
  workstation?: Workstation | null;
  weighbridge?: Weighbridge | null;
}

export function WorkstationStatusPill({ workstation, weighbridge }: Props) {
  return (
    <div className="glass-panel px-4 py-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-4 text-xs">
      <div className="flex items-center gap-6">
        {/* Scale Telemetry */}
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 radar-live" />
          <div>
            <span className="text-slate-400 text-[11px]">Active Scale:</span>{' '}
            <span className="font-semibold text-slate-200">
              {weighbridge?.name || 'Weighbridge 1'}
            </span>
            <span className="text-slate-500 font-mono text-[11px] ml-1.5">
              (Cap: {weighbridge?.max_capacity_kg?.toLocaleString() || '99,999'} kg)
            </span>
          </div>
        </div>

        {/* Workstation Host */}
        <div className="hidden sm:flex items-center gap-2 text-slate-400 text-[11px]">
          <Laptop className="w-3.5 h-3.5 text-slate-500" />
          <span>Workstation:</span>
          <span className="font-mono text-slate-300 font-medium">
            {workstation?.hostname || 'DESKTOP-128GRO4'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          Cloud Mirror Synchronized
        </span>
        <span className="text-slate-500">•</span>
        <span className="text-slate-400 font-mono">
          Last check: {formatDate(workstation?.last_seen_at || workstation?.updated_at || new Date().toISOString())}
        </span>
      </div>
    </div>
  );
}
