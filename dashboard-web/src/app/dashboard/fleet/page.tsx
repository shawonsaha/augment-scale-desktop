export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { Vehicle } from '@/lib/types';
import { formatKg, formatDateTime } from '@/lib/utils';
import { Truck } from 'lucide-react';

export default async function FleetPage() {
  const supabase = await createClient();

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('*')
    .order('trip_count', { ascending: false });

  const vehicleList = (vehicles || []) as Vehicle[];

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Fleet &amp; Vehicle Registry
          </h1>
          <p className="text-xs text-slate-400">
            Authorized vehicles, historical tare records, and haulage frequency.
          </p>
        </div>

        <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-2">
          <Truck className="w-4 h-4" />
          {vehicleList.length} Registered Trucks
        </div>
      </div>

      {/* Vehicles Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/5 text-slate-400 bg-white/[0.02]">
                <th className="py-3.5 px-4 font-medium">Plate Number</th>
                <th className="py-3.5 px-4 font-medium">Normalized</th>
                <th className="py-3.5 px-4 font-medium">Default Client</th>
                <th className="py-3.5 px-4 font-medium">Driver Contact</th>
                <th className="py-3.5 px-4 font-medium text-right">Trips Logged</th>
                <th className="py-3.5 px-4 font-medium text-right">Last Tare</th>
                <th className="py-3.5 px-4 font-medium text-right">Last Weighed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {vehicleList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No vehicles found in cloud mirror.
                  </td>
                </tr>
              ) : (
                vehicleList.map((v) => (
                  <tr key={v.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-100">
                      <span className="px-2 py-1 rounded bg-slate-900 border border-white/10 text-emerald-300">
                        {v.plate_number}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                      {v.plate_normalized}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 font-medium">
                      {v.default_client || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {v.default_driver_name || '—'} {v.default_driver_phone ? `(${v.default_driver_phone})` : ''}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-200 num-tabular">
                      {v.trip_count}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300 num-tabular">
                      {v.last_tare_kg ? formatKg(v.last_tare_kg) : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right text-slate-400 font-mono text-[11px] num-tabular">
                      {formatDateTime(v.last_weighed_at || v.updated_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
