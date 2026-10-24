import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_META_BYTES, decodeEntities, parseMeta } from '../src/plugins/lib/link-meta.mjs';

const base = 'https://example.test/posts/article';
assert.equal(decodeEntities('A &amp; B &#x1F9EC;'), 'A & B 🧬');
assert.equal(decodeEntities('&#9999999999;'), '&#9999999999;');
assert.equal(decodeEntities('&constructor;'), '&constructor;');

if (process.argv.includes('--malformed-inputs')) {
  for (const size of [1024, 8192, 64 * 1024, MAX_META_BYTES - 5]) {
    assert.equal(parseMeta('<meta' + ' '.repeat(size), base).title, '');
  }
  process.exit(0);
}

assert.deepEqual(parseMeta(`<!doctype html><html><head>
  <meta content="A > B &amp; &#x1F9EC;" property="og:title">
  <meta property='og:title' content='Ignored duplicate'>
  <meta name=description content='A &quot;quoted&quot; description'>
  <meta property=og:image content='../image.png'>
  <meta property=og:site_name content='Fixture'>
  <title>Fallback</title>
</head><body><meta property=og:title content='Outside head'></body></html>`, base), {
  title: 'A > B & 🧬', description: 'A "quoted" description',
  image: 'https://example.test/image.png', siteName: 'Fixture',
});
assert.equal(parseMeta('<title>A &copy; B</title>', base).title, 'A © B');
assert.equal(parseMeta('<meta name=twitter:title content="Twitter">', base).title, 'Twitter');
assert.equal(parseMeta('<!-- <meta property=og:title content="Comment"> --><title>Real</title>', base).title, 'Real');
assert.equal(parseMeta('<script>"<meta property=og:title content=Script>"</script><title>Real</title>', base).title, 'Real');
assert.equal(parseMeta('<template><meta property=og:title content=Template></template><title>Real</title>', base).title, 'Real');
for (const url of ['javascript:alert(1)', 'http://127.0.0.1/image.png', 'http://169.254.169.254/image.png']) {
  assert.equal(parseMeta(`<meta property=og:image content="${url}">`, base).image, '');
}
assert.throws(() => parseMeta('x'.repeat(MAX_META_BYTES + 1), base), /input limit/);
const malformed = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--malformed-inputs'], {
  timeout: 5000, maxBuffer: 64 * 1024, encoding: 'utf8',
});
assert.ifError(malformed.error);
assert.equal(malformed.status, 0, malformed.stderr);
console.log('[link-meta] HTML parsing, input limits, and malformed-input regressions passed');
