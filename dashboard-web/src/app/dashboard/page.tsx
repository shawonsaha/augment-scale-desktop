export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { WorkstationStatusPill } from '@/components/workstation-status-pill';
import { StatsCards } from '@/components/stats-cards';
import { ActivityChart } from '@/components/activity-chart';
import { LiveActivityStream } from '@/components/live-activity-stream';
import { WeighTicket, Workstation, Weighbridge } from '@/lib/types';

export default async function DashboardPage() {
  const supabase = await createClient();

  const [ticketsRes, workstationRes, weighbridgeRes] = await Promise.all([
    supabase
      .from('weigh_tickets')
      .select('*')
      .order('ticket_number', { ascending: false }),
    supabase.from('workstations').select('*').limit(1).maybeSingle(),
    supabase.from('weighbridges').select('*').limit(1).maybeSingle(),
  ]);

  const tickets = (ticketsRes.data || []) as WeighTicket[];
  const workstation = workstationRes.data as Workstation | null;
  const weighbridge = weighbridgeRes.data as Weighbridge | null;

  return (
    <div className="space-y-6">
      {/* Live Scale & Workstation Health Strip */}
      <WorkstationStatusPill workstation={workstation} weighbridge={weighbridge} />

      {/* Key Performance Indicators */}
      <StatsCards tickets={tickets} />

      {/* Middle Row: Analytics Chart & Live Monitor */}
      <ActivityChart tickets={tickets} />

      {/* Live Activity Stream & Inspection Table */}
      <LiveActivityStream initialTickets={tickets} />
    </div>
  );
}
