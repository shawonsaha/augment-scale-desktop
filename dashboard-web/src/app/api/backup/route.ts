import { fetchOperationalBackupData, generateSqlScript, generateSqliteBinary } from '@/lib/backup-generator';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const data = await fetchOperationalBackupData();

    if (format === 'sql') {
      const sqlContent = generateSqlScript(data);
      return new NextResponse(sqlContent, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="augment-scale-backup-${timestamp}.sql"`,
        },
      });
    }

    if (format === 'sqlite') {
      const binary = await generateSqliteBinary(data);
      return new NextResponse(binary as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/x-sqlite3',
          'Content-Disposition': `attachment; filename="augment-scale-cloud-backup-${timestamp}.db"`,
        },
      });
    }

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="augment-scale-cloud-backup-${timestamp}.json"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Backup generation failed' }, { status: 500 });
  }
}
