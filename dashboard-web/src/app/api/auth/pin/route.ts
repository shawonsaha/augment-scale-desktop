import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { pin } = await request.json();

    const supervisorPin = process.env.SUPERVISOR_PIN || '1234';
    if (pin === supervisorPin) {
      const supabase = await createClient();

      const adminEmail = process.env.ADMIN_AUTH_EMAIL;
      const adminPassword = process.env.ADMIN_AUTH_PASSWORD;

      if (!adminEmail || !adminPassword) {
        return NextResponse.json(
          { error: 'Server auth not configured. Set ADMIN_AUTH_EMAIL and ADMIN_AUTH_PASSWORD in .env.local.' },
          { status: 500 }
        );
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: adminEmail,
        password: adminPassword,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        user: {
          email: adminEmail,
          displayName: 'MD. RAJU (Supervisor)',
          role: 'supervisor',
        },
      });
    }

    return NextResponse.json({ error: 'Invalid Supervisor PIN.' }, { status: 401 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
