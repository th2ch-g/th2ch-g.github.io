import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const workDir = mkdtempSync(join(tmpdir(), 'github-og-check-'));
const now = Date.now();
let sequence = 0;

function fixture(repos, statuses = [200]) {
  const dir = join(workDir, String(++sequence));
  for (const path of ['scripts', 'src/plugins/lib', 'src/lib', 'src/content', 'public/github-og', 'bin']) {
    mkdirSync(join(dir, path), { recursive: true });
  }
  for (const path of [
    'scripts/build-github-og.mjs',
    'src/plugins/lib/github-og.mjs',
    'src/plugins/lib/response-body.mjs',
    'src/lib/profile-yaml.mjs',
  ]) copyFileSync(join(root, path), join(dir, path));
  writeFileSync(join(dir, 'src/plugins/lib/public-http.mjs'), 'export const fetchPublicHttp = (...args) => fetch(...args);\n');
  writeFileSync(join(dir, 'src/plugins/lib/link-meta.mjs'),
    `export { MAX_META_BYTES, parseMeta } from ${JSON.stringify(pathToFileURL(join(root, 'src/plugins/lib/link-meta.mjs')).href)};\n`);
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
  if (new URL(url).hostname === 'github.com') {
    const status = Number(process.env.CHECK_OG_PAGE_STATUS || 200);
    const image = process.env.CHECK_OG_IMAGE_URL || 'https://opengraph.githubassets.com/published' + new URL(url).pathname;
    return new Response(status === 200 ? '<meta property="og:image" content="' + image + '">' : 'unavailable', {
      status, headers: { 'content-type': 'text/html' },
    });
  }
  const status = statuses[Math.min(count++, statuses.length - 1)];
  return new Response(status === 200 ? 'downloaded-image' : 'unavailable', {
    status, headers: { 'content-type': status === 200 ? 'image/png' : 'text/plain' },
  });
};
`);
  for (const name of ['gh', 'tar']) writeFileSync(join(dir, 'bin', name), `#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(commands)}, JSON.stringify(process.argv) + '\\n');
process.exit(1);
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
    run(ci = false, extraEnv = {}) {
      const output = execFileSync(process.execPath, ['--import', join(dir, 'fetch.mjs'), join(dir, 'scripts/build-github-og.mjs')], {
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
        timeout: 15_000,
      });
      assert.deepEqual(this.commands(), [], 'Image recovery invoked gh or tar');
      return output;
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
  assert.equal(limited.requests().length, 2, 'HTTP 429 triggered more repository or image requests');
  assert.equal(readFileSync(limited.image('alpha'), 'utf8'), 'stale-alpha');
  assert.equal(readFileSync(limited.image('gamma'), 'utf8'), 'stale-gamma');
  assert.equal(existsSync(limited.image('beta')), false, 'A failed response was saved as an image');
  assert.ok(statSync(limited.image('alpha')).mtimeMs > now - 7 * 86400000,
    'A stale image was not retained for the retry backoff');

  const cold = fixture(['alpha', 'beta']);
  cold.run(true, {
    CHECK_OG_PUBLISHED: JSON.stringify({ 'fixture__alpha.png': 'published-alpha', 'fixture__beta.png': 'published-beta' }),
  });
  assert.equal(readFileSync(cold.image('alpha'), 'utf8'), 'published-alpha');
  assert.equal(readFileSync(cold.image('beta'), 'utf8'), 'published-beta');
  assert.equal(cold.requests().length, 2);
  assert.ok(cold.requests().every((url) => new URL(url).hostname === 'portfolio.example'));
  assert.ok(Math.abs(statSync(cold.image('beta')).mtimeMs - (now - 3600000)) < 1000,
    'Restoring an image reset its refresh age');

  const unavailable = fixture(['alpha']);
  unavailable.run(true);
  assert.equal(readFileSync(unavailable.image('alpha'), 'utf8'), 'downloaded-image',
    'A missing published image prevented a fresh preview download');
  assert.ok(unavailable.requests().includes('https://opengraph.githubassets.com/published/fixture/alpha'),
    'The repository og:image URL was not used');
  assert.ok(!unavailable.requests().some((url) => url.includes('githubassets.com/1/')),
    'A published preview still requested the legacy fixed URL');

  const missing = fixture(['alpha', 'beta'], [429]);
  missing.run(true, {
    CHECK_OG_PUBLISHED: JSON.stringify({ 'fixture__alpha.png': 'published-alpha' }),
  });
  assert.equal(readFileSync(missing.image('alpha'), 'utf8'), 'published-alpha');
  assert.equal(existsSync(missing.image('beta')), false);
  assert.equal(missing.requests().length, 4);

  const partial = fixture(['alpha', 'beta'], [429]);
  partial.write('alpha', 'cached-alpha');
  partial.run(true, { CHECK_OG_PUBLISHED: JSON.stringify({ 'fixture__beta.png': 'published-beta' }) });
  assert.equal(readFileSync(partial.image('alpha'), 'utf8'), 'cached-alpha');
  assert.equal(readFileSync(partial.image('beta'), 'utf8'), 'published-beta');
  assert.deepEqual(partial.commands(), [], 'A partial image cache unnecessarily downloaded build artifacts');
  assert.equal(partial.requests().length, 1);

  const transient = fixture(['alpha'], [503, 200]);
  transient.run();
  assert.equal(transient.requests().length, 3, 'Transient image errors no longer retry');
  assert.equal(readFileSync(transient.image('alpha'), 'utf8'), 'downloaded-image');

  const custom = fixture(['alpha']);
  custom.run(false, { CHECK_OG_IMAGE_URL: 'https://repository-images.githubusercontent.com/example/custom.png' });
  assert.ok(custom.requests().includes('https://repository-images.githubusercontent.com/example/custom.png'));
  assert.equal(readFileSync(custom.image('alpha'), 'utf8'), 'downloaded-image');

  const legacy = fixture(['alpha']);
  legacy.run(false, { CHECK_OG_PAGE_STATUS: '503' });
  assert.ok(legacy.requests().includes('https://opengraph.githubassets.com/1/fixture/alpha'));
  assert.equal(readFileSync(legacy.image('alpha'), 'utf8'), 'downloaded-image');

  const unsafe = fixture(['alpha']);
  unsafe.run(false, { CHECK_OG_IMAGE_URL: 'http://127.0.0.1/private.png' });
  assert.ok(!unsafe.requests().some((url) => url.includes('127.0.0.1')));
  assert.equal(readFileSync(unsafe.image('alpha'), 'utf8'), 'downloaded-image');
  console.log('[github-og] Published previews, cache recovery, public URLs, rate limits, and transient retries passed');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
