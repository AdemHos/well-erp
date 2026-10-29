/* eslint-disable @typescript-eslint/no-require-imports -- Isolated localhost PostgreSQL test runtime. */
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
function run(exe, args, env, inherit = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let output = ''; if (!inherit) { child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; }); }
    child.on('error', reject); child.on('exit', code => { child.stdout?.destroy(); child.stderr?.destroy(); code === 0 ? resolve(output) : reject(new Error(`Local process ${path.basename(exe)} failed (${code}): ${output}`)); });
  });
}
async function freePort() {
  const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function createLocalPostgres() {
  const location = path.join(root, '.tools', 'mvp-acceptance-' + crypto.randomUUID());
  fs.mkdirSync(location, { recursive: true });
  const tools = path.join(root, '.tools/postgresql/bin'), data = path.join(location, 'data'), pwfile = path.join(location, 'password.txt');
  const password = crypto.randomBytes(32).toString('hex'), port = await freePort();
  const connectionString = `postgresql://mvp_test:${password}@127.0.0.1:${port}/postgres`;
  // The supplied DATABASE_URL and .env are never used for this runtime.
  const env = { ...process.env, DATABASE_URL: connectionString, PGOPTIONS: '-c statement_timeout=30000', NEXT_TELEMETRY_DISABLED: '1' };
  const client = new Client({ connectionString }); let started = false;
  fs.writeFileSync(pwfile, password + '\n');
  const stop = async () => { await client.end().catch(() => {}); if (started) { started = false; await run(path.join(tools, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], env); } if (fs.existsSync(pwfile)) fs.unlinkSync(pwfile); };
  try {
    await run(path.join(tools, 'initdb.exe'), ['-D', data, '--encoding=UTF8', '--locale=C', '--username=mvp_test', '--auth=scram-sha-256', '--pwfile', pwfile], env);
    await run(path.join(tools, 'pg_ctl.exe'), ['-D', data, '-l', path.join(location, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], env); started = true;
    await client.connect();
    return { location, env, client, stop, async migrate() {
      const applied = [];
      for (const name of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
        const file = path.join(root, 'prisma/migrations', name, 'migration.sql');
        if (fs.existsSync(file)) { await client.query(fs.readFileSync(file, 'utf8')); applied.push(name); }
      }
      return applied;
    } };
  } catch (error) { await stop(); throw error; }
}
module.exports = { root, run, freePort, createLocalPostgres };
