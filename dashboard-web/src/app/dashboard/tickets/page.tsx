export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { WeighTicket } from '@/lib/types';
import { LiveActivityStream } from '@/components/live-activity-stream';
import { HardDriveDownload } from 'lucide-react';
import Link from 'next/link';

export default async function TicketsPage() {
  const supabase = await createClient();

  const { data: tickets } = await supabase
    .from('weigh_tickets')
    .select('*')
    .order('ticket_number', { ascending: false });

  return (
    <div className="space-y-6">
      {/* Page Title & Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Weight Tickets Ledger
          </h1>
          <p className="text-xs text-slate-400">
            Comprehensive audit registry for all weighbridge captures and transactions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/backup"
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-white/10 hover:bg-white/15 text-white flex items-center gap-2 transition-all border border-white/10"
          >
            <HardDriveDownload className="w-3.5 h-3.5 text-emerald-400" />
            Backup Database
          </Link>
        </div>
      </div>

      {/* Tickets Ledger Table */}
      <LiveActivityStream initialTickets={(tickets || []) as WeighTicket[]} />
    </div>
  );
}
