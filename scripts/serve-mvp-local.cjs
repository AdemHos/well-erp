/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic browser acceptance environment; never uses configured database. */
const { createLocalPostgres, freePort, root, run } = require('./local-postgres.cjs');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
async function main() {
  const runtime = await createLocalPostgres(); let server;
  const stop = async () => { server?.kill(); await runtime.stop(); };
  process.once('SIGINT', () => stop().finally(() => process.exit()));
  try {
    await runtime.migrate();
    require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(require('node:url').pathToFileURL(file).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
    const { PrismaClient } = require('../src/generated/prisma/client.ts'), { PrismaPg } = require('@prisma/adapter-pg');
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtime.env.DATABASE_URL }) });
    try {
      const bcrypt = require('bcryptjs');
      const org = await db.organization.create({ data: { name: 'MVP Sentetik Test İşletmesi', slug: crypto.randomUUID() } });
      const user = await db.user.create({ data: { email: 'owner@mvp.invalid', name: 'MVP Test Sahibi', password: await bcrypt.hash('LocalAcceptance2026!', 10) } });
      const membership = await db.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'OWNER' } });
      await db.staffProfile.create({ data: { organizationId: org.id, membershipId: membership.id, name: 'MVP Test Sahibi', role: 'OWNER', allBranches: true, pinHash: await bcrypt.hash('246810', 10) } });
      const branch = await db.branch.create({ data: { organizationId: org.id, name: 'MVP Test Şubesi' } });
      for (const type of ['CASH', 'CARD']) await db.financeAccount.create({ data: { organizationId: org.id, branchId: branch.id, name: type === 'CASH' ? 'Test Nakit' : 'Test Kart', type, openingBalance: 1000 } });
      const product = await db.product.create({ data: { organizationId: org.id, name: 'Test Kahve', barcode: '8690000000019', price: 75, isSellable: true } });
      await db.branchStock.create({ data: { organizationId: org.id, branchId: branch.id, productId: product.id, quantity: 20, criticalLevel: 3 } });
      await db.restaurantTable.create({ data: { organizationId: org.id, branchId: branch.id, name: 'Test Masa 1', capacity: 4 } });
    } finally { await db.$disconnect(); }
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    const env = { ...runtime.env, AUTH_SECRET: crypto.randomBytes(32).toString('hex'), AUTH_URL: origin, AUTH_TRUST_HOST: 'true', AUTH_GOOGLE_ID: 'synthetic-disabled', AUTH_GOOGLE_SECRET: 'synthetic-disabled' };
    const next = path.join(root, 'node_modules/next/dist/bin/next');
    console.log('Building production app with isolated localhost database.');
    await run(process.execPath, [next, 'build'], env, true);
    server = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', b => process.stdout.write(b)); server.stderr.on('data', b => process.stderr.write(b));
    console.log(`SYNTHETIC_BROWSER_URL=${origin}/login`);
    await new Promise(resolve => server.once('exit', resolve));
  } finally { await stop(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
