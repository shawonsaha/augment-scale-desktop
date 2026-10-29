import { LoginForm } from './login-form';
import { Scale, Activity, ArrowUpRight } from 'lucide-react';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      {/* Visual background lights */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[350px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[250px] bg-cyan-500/8 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-slate-950 shadow-xl shadow-emerald-500/20 mb-4">
            <Scale className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1.5">
            Augment Scale Cockpit
          </h1>
          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
            Industrial weighbridge monitoring &amp; cloud telemetry portal.
          </p>
        </div>

        {/* Card Form */}
        <div className="glass-panel-elevated p-6 sm:p-8 rounded-3xl">
          <LoginForm />
        </div>

        {/* Workstation Info Footer */}
        <div className="mt-8 text-center text-xs text-slate-500 space-y-1">
          <p className="flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Supabase Cloud Connected • Site: Postogola Main Yard
          </p>
          <p className="text-[11px] text-slate-600 font-mono">
            Workstation: DESKTOP-128GRO4 | Weighbridge 1 (99,999 KG)
          </p>
        </div>
      </div>
    </div>
  );
}
