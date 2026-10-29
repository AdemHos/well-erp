/* eslint-disable @typescript-eslint/no-require-imports -- Deployment utility. */
// Run with: npx --yes --package vercel@65.5.0 -- node scripts/configure-vercel-env.cjs
// Values go through stdin, never through shell arguments or console output.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'));

async function main() {
  const cli = (process.env.PATH || '').split(path.delimiter)
    .map(dir => path.resolve(dir, '../vercel/dist/index.js')).find(file => fs.existsSync(file));
  if (!cli) throw new Error('Run this script with npx --package vercel@65.5.0.');
  if (!fs.existsSync(path.resolve(__dirname, '../.vercel/project.json'))) throw new Error('Link the Vercel project first.');
  const names = ['DATABASE_URL', 'AUTH_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'UPLOADTHING_TOKEN', 'AI_PROVIDER', 'GEMINI_MODEL', 'GEMINI_API_KEY'];
  const values = Object.fromEntries(names.map(name => [name, process.env[name]?.trim()]));
  values.AUTH_TRUST_HOST = 'true';
  const missing = names.filter(name => !values[name]);
  if (missing.length) throw new Error('Missing environment variables: ' + missing.join(', '));
  for (const [name, value] of Object.entries(values)) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'env', 'add', name, '--environment', 'production,preview', '--force', '--sensitive', '--yes'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      // Do not relay provider output; it may include secret input diagnostics.
      child.stdout.resume(); child.stderr.resume();
      child.on('error', () => reject(new Error('Could not start Vercel CLI for ' + name)));
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('Vercel env failed for ' + name + ' (exit ' + code + ')')));
      child.stdin.on('error', () => {});
      child.stdin.end(value);
    });
    console.log(name + ': uploaded');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
