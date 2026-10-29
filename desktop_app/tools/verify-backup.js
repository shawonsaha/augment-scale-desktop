const initSqlJs = require('../../dashboard-web/node_modules/sql.js');

async function verify() {
  const pinRes = await fetch('http://localhost:3000/api/auth/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234' })
  });
  const cookie = pinRes.headers.get('set-cookie');
  const backupRes = await fetch('http://localhost:3000/api/backup?format=sqlite', {
    headers: { 'Cookie': cookie }
  });
  const buf = await backupRes.arrayBuffer();
  const SQL = await initSqlJs();
  const db = new SQL.Database(new Uint8Array(buf));
  
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
  console.log('Tables in exported backup:', tables[0].values.flat());

  const tickets = db.exec("SELECT ticket_number, plate_number, status, deleted_at, is_overridden FROM weigh_tickets ORDER BY ticket_number DESC;");
  console.log('Tickets count in SQLite export:', tickets[0].values.length);
  console.log('Tickets top 4:');
  tickets[0].values.slice(0, 4).forEach((row) => console.log(' ', row));
}

verify().catch(console.error);
