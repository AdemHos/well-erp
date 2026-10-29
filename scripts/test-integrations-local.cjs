/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local PostgreSQL verification, never reads DATABASE_URL. */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..'), tools = path.join(root, '.tools/postgresql/bin');
function run(exe, args, env, inherit = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let output = ''; if (!inherit) { child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; }); }
    child.on('error', reject); child.on('exit', code => { child.stdout?.destroy(); child.stderr?.destroy(); if (code === 0) resolve(output); else reject(new Error(`Local verification process failed (${code}): ${output}`)); });
  });
}
async function main() {
  const location = path.join(root, '.tools/local-invoice-test-' + crypto.randomUUID()); fs.mkdirSync(location, { recursive: true });
  const password = crypto.randomBytes(32).toString('hex'), pwfile = path.join(location, 'password.txt'), data = path.join(location, 'data'); fs.writeFileSync(pwfile, password + '\n');
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const connectionString = `postgresql://finance_test:${password}@127.0.0.1:${port}/postgres`;
  const env = { ...process.env, DATABASE_URL: connectionString, WELLPOS_INTEGRATIONS_DB_TEST: '1', WELLPOS_QR_DB_TEST: '1', WELLPOS_REPORTS_DB_TEST: '1', WELLPOS_SUPPLIERS_DB_TEST: '1', WELLPOS_CUSTOMERS_DB_TEST: '1', WELLPOS_FINANCE_DB_TEST: '1', WELLPOS_CURRENT_ACCOUNTS_DB_TEST: '1', WELLPOS_PAYMENTS_DB_TEST: '1', WELLPOS_INVOICES_DB_TEST: '1', WELLPOS_EXPENSES_DB_TEST: '1' };
  const client = new Client({ connectionString }); let started = false;
  try {
    await run(path.join(tools, 'initdb.exe'), ['-D', data, '--encoding=UTF8', '--locale=C', '--username=finance_test', '--auth=scram-sha-256', '--pwfile', pwfile], env);
    await run(path.join(tools, 'pg_ctl.exe'), ['-D', data, '-l', path.join(location, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], env); started = true;
    await client.connect();
    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
      const file = path.join(root, 'prisma/migrations', name, 'migration.sql');
      if (fs.existsSync(file)) await client.query(fs.readFileSync(file, 'utf8'));
    }
    console.log('Integrations tests: NEW localhost PostgreSQL, all existing migrations, no Neon access.');
    const tests = process.argv.includes('--all') ? ['tests/integrations.integration.test.cjs', 'tests/qr-service.integration.test.cjs', 'tests/reports.integration.test.cjs', 'tests/suppliers.integration.test.cjs', 'tests/customers.integration.test.cjs', 'tests/current-accounts.integration.test.cjs', 'tests/invoices.integration.test.cjs', 'tests/payments.integration.test.cjs', 'tests/expenses.integration.test.cjs', 'tests/pos-finance.integration.test.cjs', 'tests/checkout-schema-compatibility.test.cjs'] : ['tests/integrations.integration.test.cjs'];
    await run(process.execPath, ['--test', '--test-concurrency=1', ...tests], env, true);
  } finally { await client.end().catch(() => {}); if (started) await run(path.join(tools, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], env); if (fs.existsSync(pwfile)) fs.unlinkSync(pwfile); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
