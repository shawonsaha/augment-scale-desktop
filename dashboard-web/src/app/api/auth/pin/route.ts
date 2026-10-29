import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { pin } = await request.json();

    // Supervisor PIN from setup.json is "1234"
    if (pin === '1234') {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'admin@augmentscale.com',
        password: 'AugmentScale2026!',
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        user: {
          email: 'admin@augmentscale.com',
          displayName: 'MD. RAJU (Supervisor)',
          role: 'supervisor',
        },
      });
    }

    return NextResponse.json({ error: 'Invalid Supervisor PIN. Check setup.json.' }, { status: 401 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
