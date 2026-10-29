'use client';

import { WeighTicket } from '@/lib/types';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';

interface Props {
  tickets: WeighTicket[];
}

export function ActivityChart({ tickets }: Props) {
  // Aggregate tickets by ticket number or day
  const data = tickets.map((t) => ({
    name: `#${t.ticket_display_id || t.ticket_number}`,
    plate: t.plate_number,
    direction: t.direction,
    net: Math.round((t.net_weight_kg || 0) / 1000 * 100) / 100,
    gross: Math.round((t.first_weight_kg || 0) / 1000 * 100) / 100,
    status: t.status,
  }));

  return (
    <div className="glass-panel p-5 rounded-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Tonnage Throughput per Vehicle
          </h3>
          <p className="text-xs text-slate-400">
            Recorded Gross vs Net Cargo (Metric Tons)
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400" />
            <span className="text-slate-300">Gross (MT)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
            <span className="text-slate-300">Net Cargo (MT)</span>
          </div>
        </div>
      </div>

      <div className="h-[220px] w-full">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            No ticket volume recorded yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis 
                dataKey="name" 
                stroke="#64748b" 
                fontSize={11} 
                tickLine={false}
              />
              <YAxis 
                stroke="#64748b" 
                fontSize={11} 
                tickLine={false}
                tickFormatter={(val) => `${val}T`}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '12px',
                  fontSize: '12px',
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
                }}
                formatter={(value: any, name: any, item: any) => [
                  `${value} MT (${item.payload.plate})`,
                  name === 'net' ? 'Net Cargo' : 'Gross Weight',
                ]}
              />
              <Bar dataKey="gross" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="net" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
