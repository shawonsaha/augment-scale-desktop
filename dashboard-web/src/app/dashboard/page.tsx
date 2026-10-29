export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { WeighTicket, Workstation, Weighbridge, PrintJobEntry } from '@/lib/types';
import { DashboardView } from '@/components/dashboard-view';

export default async function DashboardPage() {
  const supabase = await createClient();

  const [ticketsRes, workstationRes, weighbridgeRes, printJobsRes] = await Promise.all([
    supabase
      .from('ticket_history')
      .select('*')
      .order('ticket_number', { ascending: false }),
    supabase.from('workstations').select('*').limit(1).maybeSingle(),
    supabase.from('weighbridges').select('*').limit(1).maybeSingle(),
    supabase.from('print_jobs').select('*'),
  ]);

  const rawTickets = (ticketsRes.data || []) as WeighTicket[];
  const printJobs = (printJobsRes.data || []) as PrintJobEntry[];

  // Attach print_jobs to corresponding tickets
  const tickets: WeighTicket[] = rawTickets.map((t) => {
    const jobs = printJobs.filter((pj) => pj.ticket_id === t.id);
    return {
      ...t,
      print_jobs: jobs,
      print_count: Math.max(t.print_count || 0, jobs.length),
    };
  });

  const workstation = workstationRes.data as Workstation | null;
  const weighbridge = weighbridgeRes.data as Weighbridge | null;

  return (
    <DashboardView
      initialTickets={tickets}
      workstation={workstation}
      weighbridge={weighbridge}
    />
  );
}
