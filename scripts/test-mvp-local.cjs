/* eslint-disable @typescript-eslint/no-require-imports -- Runs only on a newly created localhost PostgreSQL cluster. */
const fs = require('node:fs'), path = require('node:path');
const { root, run, createLocalPostgres } = require('./local-postgres.cjs');
async function main() {
  const runtime = await createLocalPostgres();
  try {
    const migrations = await runtime.migrate();
    console.log(`Applied ${migrations.length} migrations to NEW isolated localhost PostgreSQL; Neon untouched.`);
    const flags = ['MVP', 'SETTINGS', 'INTEGRATIONS', 'QR', 'REPORTS', 'SUPPLIERS', 'CUSTOMERS', 'FINANCE', 'CURRENT_ACCOUNTS', 'PAYMENTS', 'INVOICES', 'EXPENSES', 'RBAC', 'PROFILES'];
    const env = { ...runtime.env, ...Object.fromEntries(flags.map(name => ['WELLPOS_' + name + '_DB_TEST', '1'])) };
    const selection = process.argv.find(arg => arg.startsWith('--cases='));
    const tests = selection ? selection.slice(8).split(',') : process.argv.includes('--focused') ? ['mvp-acceptance'] : ['mvp-acceptance', 'settings', 'integrations', 'qr-service', 'reports', 'suppliers', 'customers', 'current-accounts', 'invoices', 'payments', 'expenses', 'pos-finance', 'rbac', 'staff-profiles'];
    if (tests.some(name => !/^[a-z-]+$/.test(name))) throw new Error('Invalid test selection');
    const args = tests.map(name => 'tests/' + name + '.integration.test.cjs');
    if (!process.argv.includes('--focused')) args.push('tests/checkout-schema-compatibility.test.cjs');
    await run(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...args], env, true);
    fs.mkdirSync(path.join(root, 'docs/acceptance'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/acceptance/local-database.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), environment: 'new isolated localhost PostgreSQL', migrations, tests: args, result: 'PASS', neonModified: false }, null, 2));
  } finally { await runtime.stop(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
