/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS backup utility. */
/* Restore a backup ONLY to a new, isolated local PostgreSQL instance. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const tools = path.join(root, ".tools", "postgresql", "bin");
function run(name, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(tools, name + ".exe"), args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    // pg_ctl's detached Windows server can inherit pipe handles; waiting for
    // "close" would wait for the server lifetime instead of pg_ctl completion.
    child.on("exit", code => {
      child.stdout.destroy();
      child.stderr.destroy();
      if (code === 0) resolve(stdout);
      else reject(new Error(`${name} failed (${code}): ${stderr}`));
    });
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function main() {
  const backupRoot = path.join(root, ".backups");
  const names = fs.readdirSync(backupRoot).filter(name => fs.existsSync(path.join(backupRoot, name, "manifest.json"))).sort((a, b) => {
    const completed = name => Date.parse(JSON.parse(fs.readFileSync(path.join(backupRoot, name, "manifest.json"), "utf8")).completedAt);
    return completed(a) - completed(b);
  });
  if (!names.length) throw new Error("No validated backup found");
  const backupDir = path.join(backupRoot, names.at(-1));
  const manifestFile = path.join(backupDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const archive = path.join(backupDir, "wellpos.dump");
  if (crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex") !== manifest.sha256) throw new Error("Backup checksum mismatch");
  const verifyRoot = path.join(backupDir, "restore-check-" + new Date().toISOString().replace(/[:.]/g, "-"));
  const dataDir = path.join(verifyRoot, "data");
  fs.mkdirSync(verifyRoot, { recursive: true });
  if (fs.existsSync(dataDir)) throw new Error("Verification data directory already exists; refusing to overwrite");
  const password = crypto.randomBytes(32).toString("hex");
  const passwordFile = path.join(verifyRoot, "init-password.txt");
  fs.writeFileSync(passwordFile, password + "\n");
  const port = await freePort();
  const env = { ...process.env, PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: "backup_verify", PGDATABASE: "postgres", PGPASSWORD: password, PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "10" };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  let started = false;
  const client = new Client({ host: "127.0.0.1", port, user: "backup_verify", password, database: "postgres", ssl: false, connectionTimeoutMillis: 10000 });
  try {
    await run("initdb", ["--pgdata", dataDir, "--encoding=UTF8", "--locale=C", "--username=backup_verify", "--auth=scram-sha-256", "--pwfile", passwordFile], env);
    await run("pg_ctl", ["-D", dataDir, "-l", path.join(verifyRoot, "server.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], env);
    started = true;
    await run("pg_restore", ["--no-password", "--exit-on-error", "--no-owner", "--no-privileges", "--dbname=postgres", archive], env);
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const restoredCounts = {};
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    for (const [qualified, expected] of Object.entries(manifest.tableRowCounts)) {
      const [schema, table] = qualified.split(".");
      const actual = (await client.query(`SELECT count(*)::text AS count FROM ${quote(schema)}.${quote(table)}`)).rows[0].count;
      if (actual !== expected) throw new Error(`Restored row count mismatch for ${qualified}`);
      restoredCounts[qualified] = actual;
    }
    const restoredTableCount = Number((await client.query("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%'")).rows[0].count);
    if (restoredTableCount !== manifest.tableCount) throw new Error("Restored table count mismatch");
    await client.query("ROLLBACK");
    if (process.argv.includes('--payments-rehearsal')) {
      const checks = require('./payment-deployment-checks.cjs');
      if (manifest.label !== 'before-payments') throw new Error('Payments rehearsal requires before-payments backup');
      const sql = fs.readFileSync(path.join(root, 'prisma/migrations', checks.target, 'migration.sql'));
      if (checks.hash(sql) !== checks.expected) throw new Error('Payments SQL checksum mismatch');
      const inventory = await checks.tables(client);
      const before = await checks.snapshot(client, inventory);
      await client.query(sql.toString());
      const result = await checks.verify(client, before, inventory);
      manifest.validation.paymentMigrationRehearsal = 'PASS';
      manifest.validation.paymentMigrationSha256 = checks.expected;
      fs.writeFileSync(path.join(verifyRoot, 'payments-rehearsal.json'), JSON.stringify(result, null, 2));
    }
    if (process.argv.includes('--customers-rehearsal')) {
      const checks = require('./customer-deployment-checks.cjs');
      if (manifest.label !== 'before-customers') throw new Error('Customer rehearsal requires before-customers backup');
      const sql = fs.readFileSync(path.join(root, 'prisma/migrations', checks.target, 'migration.sql'));
      if (checks.hash(sql) !== checks.expected) throw new Error('Customer SQL checksum mismatch');
      const inventory = await checks.tables(client);
      const before = await checks.snapshot(client, inventory);
      await client.query(sql.toString());
      const result = await checks.verify(client, before, inventory);
      manifest.validation.customerMigrationRehearsal = 'PASS';
      manifest.validation.customerMigrationSha256 = checks.expected;
      fs.writeFileSync(path.join(verifyRoot, 'customers-rehearsal.json'), JSON.stringify(result, null, 2));
    }
    if (process.argv.includes('--suppliers-rehearsal')) {
      const checks = require('./supplier-deployment-checks.cjs');
      if (manifest.label !== 'before-suppliers') throw new Error('Supplier rehearsal requires before-suppliers backup');
      const sql = fs.readFileSync(path.join(root, 'prisma/migrations', checks.target, 'migration.sql'));
      if (checks.hash(sql) !== checks.expected) throw new Error('Supplier SQL checksum mismatch');
      const inventory = await checks.tables(client);
      const before = await checks.snapshot(client, inventory);
      await client.query(sql.toString());
      const result = await checks.verify(client, before, inventory);
      manifest.validation.supplierMigrationRehearsal = 'PASS';
      manifest.validation.supplierMigrationSha256 = checks.expected;
      fs.writeFileSync(path.join(verifyRoot, 'suppliers-rehearsal.json'), JSON.stringify(result, null, 2));
    }
    if (process.argv.includes('--qr-rehearsal')) {
      const checks = require('./qr-deployment-checks.cjs');
      if (manifest.label !== 'before-qr-service') throw new Error('QR rehearsal requires before-qr-service backup');
      const sql = fs.readFileSync(path.join(root, 'prisma/migrations', checks.target, 'migration.sql'));
      if (checks.hash(sql) !== checks.expected) throw new Error('QR SQL checksum mismatch');
      const inventory = await checks.tables(client);
      const before = await checks.snapshot(client, inventory);
      await client.query(sql.toString());
      const result = await checks.verify(client, before, inventory);
      manifest.validation.qrMigrationRehearsal = 'PASS';
      manifest.validation.qrMigrationSha256 = checks.expected;
      fs.writeFileSync(path.join(verifyRoot, 'qr-rehearsal.json'), JSON.stringify(result, null, 2));
    }
    if (process.argv.includes('--integrations-rehearsal')) {
      const checks = require('./integration-deployment-checks.cjs');
      if (manifest.label !== 'before-integrations') throw new Error('Integrations rehearsal requires before-integrations backup');
      const sql = fs.readFileSync(path.join(root, 'prisma/migrations', checks.target, 'migration.sql'));
      if (checks.hash(sql) !== checks.expected) throw new Error('Integrations SQL checksum mismatch');
      const inventory = await checks.tables(client);
      const before = await checks.snapshot(client, inventory);
      await client.query(sql.toString());
      const result = await checks.verify(client, before, inventory);
      manifest.validation.integrationMigrationRehearsal = 'PASS';
      manifest.validation.integrationMigrationSha256 = checks.expected;
      fs.writeFileSync(path.join(verifyRoot, 'integrations-rehearsal.json'), JSON.stringify(result, null, 2));
    }
    if (process.argv.includes('--vercel-rehearsal')) {
      if (manifest.label !== 'before-vercel-deploy') throw new Error('Vercel rehearsal requires before-vercel-deploy backup');
      const migrations = ['20261027020000_add_management_settings', '20261027030000_harden_legacy_tenant_relations'];
      const originalTables = Object.keys(manifest.tableRowCounts);
      const columns = {};
      const snapshot = async () => {
        const result = {};
        for (const qualified of originalTables) {
          const [schema, table] = qualified.split('.');
          if (!columns[qualified]) columns[qualified] = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, table])).rows.map(row => row.column_name);
          const selected = columns[qualified].map(quote).join(',');
          const row = (await client.query(`SELECT count(*)::text AS count, md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) AS digest FROM (SELECT ${selected} FROM ${quote(schema)}.${quote(table)}) t`)).rows[0];
          result[qualified] = row;
        }
        return result;
      };
      const before = await snapshot();
      const hashes = {};
      for (const name of migrations) {
        const sql = fs.readFileSync(path.join(root, 'prisma/migrations', name, 'migration.sql'));
        hashes[name] = crypto.createHash('sha256').update(sql).digest('hex');
        await client.query(sql.toString());
      }
      const after = await snapshot();
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Original data changed during Vercel migration rehearsal');
      manifest.validation.vercelMigrationRehearsal = 'PASS';
      manifest.validation.vercelMigrationSha256 = hashes;
      fs.writeFileSync(path.join(verifyRoot, 'vercel-rehearsal.json'), JSON.stringify({ migrations, hashes, originalDataUnchanged: true, tables: originalTables.length }, null, 2));
    }
    manifest.validation.restoreToDatabase = "PASS";
    manifest.validation.restoredTableCount = restoredTableCount;
    manifest.validation.allTableRowCountsMatch = true;
    manifest.validation.restoreVerifiedAt = new Date().toISOString();
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(verifyRoot, "row-counts.json"), JSON.stringify(restoredCounts, null, 2));
    console.log(JSON.stringify({ backupDir, restoredTableCount, allTableRowCountsMatch: true, archiveSha256: manifest.sha256 }));
  } finally {
    await client.end().catch(() => {});
    if (started) await run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"], env);
    // This is a temporary generated local verification credential, not user data.
    if (fs.existsSync(passwordFile)) fs.unlinkSync(passwordFile);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
