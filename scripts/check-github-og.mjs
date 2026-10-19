import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workDir = mkdtempSync(join(tmpdir(), 'github-og-check-'));
const now = Date.now();
let sequence = 0;

function fixture(repos, statuses = [200]) {
  const dir = join(workDir, String(++sequence));
  for (const path of ['scripts', 'src/plugins/lib', 'src/lib', 'src/content', 'public/github-og', 'bin', 'archives']) {
    mkdirSync(join(dir, path), { recursive: true });
  }
  for (const path of [
    'scripts/build-github-og.mjs',
    'src/plugins/lib/github-og.mjs',
    'src/plugins/lib/response-body.mjs',
    'src/lib/profile-yaml.mjs',
  ]) copyFileSync(join(root, path), join(dir, path));
  writeFileSync(join(dir, 'src/plugins/lib/public-http.mjs'), 'export const fetchPublicHttp = (...args) => fetch(...args);\n');
  writeFileSync(join(dir, 'src/content/profile.yaml'), 'site: https://portfolio.example\n');
  writeFileSync(join(dir, 'src/content/post.md'), repos.map((repo) => `https://github.com/fixture/${repo}`).join('\n\n'));
  const requests = join(dir, 'requests.log');
  const commands = join(dir, 'commands.log');
  writeFileSync(requests, '');
  writeFileSync(commands, '');
  writeFileSync(join(dir, 'fetch.mjs'), `
import { appendFileSync } from 'node:fs';
const statuses = ${JSON.stringify(statuses)};
let count = 0;
globalThis.fetch = async (url) => {
  appendFileSync(${JSON.stringify(requests)}, url + '\\n');
  if (new URL(url).hostname === 'portfolio.example') {
    const published = JSON.parse(process.env.CHECK_OG_PUBLISHED || '{}');
    const image = published[new URL(url).pathname.split('/').at(-1)];
    return new Response(image || 'not found', {
      status: image ? 200 : 404,
      headers: {
        'content-type': image ? 'image/png' : 'text/plain',
        'last-modified': ${JSON.stringify(new Date(now - 3600000).toUTCString())},
      },
    });
  }
  const status = statuses[Math.min(count++, statuses.length - 1)];
  return new Response(status === 200 ? 'downloaded-image' : 'unavailable', {
    status, headers: { 'content-type': status === 200 ? 'image/png' : 'text/plain' },
  });
};
`);
  writeFileSync(join(dir, 'bin/gh'), `#!/usr/bin/env node
const { appendFileSync, copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(commands)}, JSON.stringify(args) + '\\n');
if (process.env.CHECK_OG_GH_FAIL === 'true') process.exit(1);
if (args[1] === 'list') console.log(JSON.stringify([{ databaseId: 2 }, { databaseId: 1 }]));
else if (args[1] === 'download') {
  if (process.env.CHECK_OG_GH_EXPIRED === 'true') process.exit(1);
  const destination = args[args.indexOf('--dir') + 1];
  mkdirSync(destination, { recursive: true });
  copyFileSync(join(${JSON.stringify(join(dir, 'archives'))}, args[2] + '.tar'), join(destination, 'artifact.tar'));
} else process.exit(2);
`, { mode: 0o755 });
  return {
    dir,
    image(repo) { return join(dir, 'public/github-og', `fixture__${repo}.png`); },
    write(repo, content, ageMs = 0) {
      const file = this.image(repo);
      writeFileSync(file, content);
      const time = new Date(now - ageMs);
      utimesSync(file, time, time);
    },
    archive(id, images, ageMs) {
      const source = join(dir, 'archives', String(id));
      mkdirSync(join(source, 'github-og'), { recursive: true });
      for (const [repo, content] of Object.entries(images)) {
        const file = join(source, 'github-og', `fixture__${repo}.png`);
        writeFileSync(file, content);
        const time = new Date(now - ageMs);
        utimesSync(file, time, time);
      }
      execFileSync('tar', ['-cf', join(dir, 'archives', `${id}.tar`), '-C', source, './github-og']);
    },
    run(ci = false, extraEnv = {}) {
      return execFileSync(process.execPath, ['--import', join(dir, 'fetch.mjs'), join(dir, 'scripts/build-github-og.mjs')], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: join(dir, 'bin') + delimiter + process.env.PATH,
          GITHUB_ACTIONS: ci ? 'true' : '',
          GITHUB_REPOSITORY: 'fixture/site',
          GITHUB_REF_NAME: 'main',
          GITHUB_TOKEN: 'fixture-token',
          ...extraEnv,
        },
        stdio: 'pipe',
      });
    },
    requests() { return readFileSync(requests, 'utf8').trim().split('\n').filter(Boolean); },
    commands() { return readFileSync(commands, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); },
  };
}

try {
  const warm = fixture(['alpha', 'beta']);
  warm.write('alpha', 'cached-alpha');
  warm.write('beta', 'cached-beta');
  warm.run(true);
  assert.deepEqual(warm.requests(), [], 'Fresh cached images were downloaded again');
  assert.deepEqual(warm.commands(), [], 'A warm cache unnecessarily downloaded deployment artifacts');
  assert.equal(readFileSync(warm.image('alpha'), 'utf8'), 'cached-alpha');

  const limited = fixture(['alpha', 'beta', 'gamma'], [429]);
  limited.write('alpha', 'stale-alpha', 8 * 86400000);
  limited.write('gamma', 'stale-gamma', 8 * 86400000);
  limited.run();
  assert.equal(limited.requests().length, 1, 'HTTP 429 triggered more preview requests');
  assert.equal(readFileSync(limited.image('alpha'), 'utf8'), 'stale-alpha');
  assert.equal(readFileSync(limited.image('gamma'), 'utf8'), 'stale-gamma');
  assert.equal(existsSync(limited.image('beta')), false, 'A failed response was saved as an image');
  assert.ok(statSync(limited.image('alpha')).mtimeMs > now - 7 * 86400000,
    'A stale image was not retained for the retry backoff');

  const cold = fixture(['alpha', 'beta']);
  cold.archive(2, { alpha: 'latest-alpha', unrelated: 'unused' }, 3600000);
  cold.archive(1, { alpha: 'older-alpha', beta: 'previous-beta' }, 7200000);
  cold.run(true);
  assert.equal(readFileSync(cold.image('alpha'), 'utf8'), 'latest-alpha', 'Older artifacts replaced a newer preview');
  assert.equal(readFileSync(cold.image('beta'), 'utf8'), 'previous-beta', 'A missing preview was not recovered');
  assert.equal(existsSync(cold.image('unrelated')), false, 'Unused artifact images were restored');
  assert.deepEqual(cold.requests(), [], 'Recovered fresh images were downloaded again');
  assert.equal(cold.commands().filter((args) => args[1] === 'download').length, 2);
  assert.ok(Math.abs(statSync(cold.image('beta')).mtimeMs - (now - 7200000)) < 1000,
    'Restoring an image reset its refresh age');

  const unavailable = fixture(['alpha']);
  unavailable.run(true, { CHECK_OG_GH_FAIL: 'true' });
  assert.equal(readFileSync(unavailable.image('alpha'), 'utf8'), 'downloaded-image',
    'Unavailable deployment artifacts prevented a fresh preview download');

  const expired = fixture(['alpha', 'beta'], [429]);
  expired.run(true, {
    CHECK_OG_GH_EXPIRED: 'true',
    CHECK_OG_PUBLISHED: JSON.stringify({ 'fixture__alpha.png': 'published-alpha', 'fixture__beta.png': 'published-beta' }),
  });
  assert.equal(readFileSync(expired.image('alpha'), 'utf8'), 'published-alpha');
  assert.equal(readFileSync(expired.image('beta'), 'utf8'), 'published-beta');
  assert.equal(expired.requests().length, 2);
  assert.ok(expired.requests().every((url) => new URL(url).hostname === 'portfolio.example'),
    'Expired CI artifacts triggered upstream requests despite available deployed previews');

  const partial = fixture(['alpha', 'beta'], [429]);
  partial.write('alpha', 'cached-alpha');
  partial.run(true, { CHECK_OG_PUBLISHED: JSON.stringify({ 'fixture__beta.png': 'published-beta' }) });
  assert.equal(readFileSync(partial.image('alpha'), 'utf8'), 'cached-alpha');
  assert.equal(readFileSync(partial.image('beta'), 'utf8'), 'published-beta');
  assert.deepEqual(partial.commands(), [], 'A partial image cache unnecessarily downloaded build artifacts');
  assert.equal(partial.requests().length, 1);

  const transient = fixture(['alpha'], [503, 200]);
  transient.run();
  assert.equal(transient.requests().length, 2, 'Transient errors no longer retry');
  assert.equal(readFileSync(transient.image('alpha'), 'utf8'), 'downloaded-image');
  console.log('[github-og] Cache reuse, deployment recovery, rate-limit handling, and transient retries passed');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
