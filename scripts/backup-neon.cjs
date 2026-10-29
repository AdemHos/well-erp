/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS backup utility. */
/* Standard pg_dump backup; never modifies the source database. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
require("dotenv").config({ quiet: true });

function run(executable, args, env, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ["ignore", output ?? "pipe", "pipe"] });
    let stdout = "", stderr = "";
    if (child.stdout) child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(executable)} failed (${code}): ${stderr}`)));
  });
}

async function main() {
  const label = process.argv[2] ?? "before-expenses";
  if (!/^[a-z0-9-]{1,60}$/.test(label)) throw new Error("Backup label must use lowercase letters, digits and hyphens");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  const url = new URL(process.env.DATABASE_URL);
  if (!url.hostname.endsWith(".neon.tech")) throw new Error("Configured source is not Neon");
  // Use a direct connection for the shared backup snapshot.
  url.hostname = url.hostname.replace("-pooler.", ".");
  url.searchParams.set("sslmode", "verify-full");
  const root = path.resolve(__dirname, "..");
  const toolRoot = path.join(root, ".tools", "postgresql");
  const dumpTool = path.join(toolRoot, "pg_dump.exe");
  const restoreTool = path.join(toolRoot, "pg_restore.exe");
  if (!fs.existsSync(dumpTool) || !fs.existsSync(restoreTool)) throw new Error("Portable PostgreSQL tools are missing");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(root, ".backups", `wellpos-${label}-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const archive = path.join(backupDir, "wellpos.dump");
  // libpq on Windows does not automatically use Node's bundled trust roots.
  // Keep hostname/chain verification enabled and supply those public roots.
  const certificateBundle = path.join(toolRoot, "trusted-root-certificates.pem");
  fs.writeFileSync(certificateBundle, require("node:tls").rootCertificates.join("\n") + "\n");
  const environment = {
    ...process.env,
    PGHOST: url.hostname, PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: "verify-full", PGSSLROOTCERT: certificateBundle, PGCONNECT_TIMEOUT: "20",
  };
  delete environment.PGSERVICE;
  delete environment.PGSERVICEFILE;
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 20000 });
  let snapshotOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    snapshotOpen = true;
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS snapshot, current_setting('server_version') AS version, current_database() AS database")).rows[0];
    const tables = (await client.query("SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' ORDER BY schemaname, tablename")).rows;
    const counts = {};
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    for (const table of tables) {
      const name = `${table.schemaname}.${table.tablename}`;
      counts[name] = (await client.query(`SELECT count(*)::text AS count FROM ${quote(table.schemaname)}.${quote(table.tablename)}`)).rows[0].count;
    }
    const extensions = (await client.query("SELECT extname, extversion FROM pg_extension ORDER BY extname")).rows;
    const migrations = tables.some(table => table.tablename === "_prisma_migrations" && table.schemaname === "public")
      ? (await client.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY started_at')).rows : [];
    await run(dumpTool, ["--format=custom", "--compress=gzip:6", "--no-password", "--lock-wait-timeout=15s", `--snapshot=${snapshot.snapshot}`, `--file=${archive}`], environment);
    await client.query("ROLLBACK");
    snapshotOpen = false;
    const toc = await run(restoreTool, ["--list", archive], environment);
    fs.writeFileSync(path.join(backupDir, "archive-contents.txt"), toc);
    // Read and decompress every archive item without executing SQL anywhere.
    await run(restoreTool, ["--file=NUL", archive], environment);
    const stat = fs.statSync(archive);
    if (stat.size < 100) throw new Error("Backup archive is unexpectedly empty");
    const manifest = {
      label, startedAt: timestamp, completedAt: new Date().toISOString(),
      sourceDatabase: snapshot.database, serverVersion: snapshot.version,
      format: "PostgreSQL custom archive", file: "wellpos.dump", bytes: stat.size,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"),
      consistentSharedSnapshot: true, sourceReadOnly: true,
      tableCount: tables.length, tableRowCounts: counts, extensions, migrations,
      validation: { archiveList: "PASS", fullArchiveRead: "PASS", restoreToDatabase: "NOT_RUN" },
      includes: "Database schema, table data, sequences, and database-local objects; not cluster-global roles or external uploaded files.",
      credentialsIncludedInManifest: false,
    };
    fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ backupDir, archive, bytes: stat.size, sha256: manifest.sha256, tableCount: tables.length, serverVersion: snapshot.version, validation: manifest.validation }));
  } finally {
    if (snapshotOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

main().catch(error => {
  let message = error.message || error.code || error.name;
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    message = message.replaceAll(process.env.DATABASE_URL, "[REDACTED_DATABASE_URL]");
    for (const secret of [url.password, decodeURIComponent(url.password)]) if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }
  console.error(message);
  process.exitCode = 1;
});
