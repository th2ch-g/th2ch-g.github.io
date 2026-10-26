import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const result = spawnSync(process.platform === 'win32' ? 'lhci.cmd' : 'lhci', [
  'autorun', '--config=./lighthouserc.json',
], {
  stdio: 'inherit',
  env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || chromium.executablePath() },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
