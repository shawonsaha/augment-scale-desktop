import { DashboardHeader } from '@/components/dashboard-header';
import { RealtimeProvider } from '@/lib/context/realtime-context';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RealtimeProvider>
      <div className="min-h-screen flex flex-col">
        <DashboardHeader />
        <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
          {children}
        </div>
      </div>
    </RealtimeProvider>
  );
}
