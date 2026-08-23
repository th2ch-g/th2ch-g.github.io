import { spawn } from 'node:child_process';

const scripts = process.argv.slice(2);
if (scripts.length === 0) {
  console.error('Usage: node scripts/run-scripts-parallel.mjs <script> [...]');
  process.exit(1);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runScript(name) {
  return new Promise((resolve) => {
    const child = spawn(npmCommand, ['run', name], {
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', (error) => resolve({ name, error }));
    child.once('exit', (code, signal) => resolve({ name, code, signal }));
  });
}

const results = await Promise.all(scripts.map(runScript));
const failures = results.filter(({ code, error }) => error || code !== 0);

if (failures.length > 0) {
  for (const { name, code, signal, error } of failures) {
    const reason = error?.message ?? signal ?? `exit code ${code}`;
    console.error(`[parallel] ${name} failed: ${reason}`);
  }
  process.exitCode = 1;
}
