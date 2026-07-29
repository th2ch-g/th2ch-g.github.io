import assert from 'node:assert/strict';
import {
  fetchPublicHttp,
  parsePublicHttpUrl,
} from '../src/plugins/lib/public-http.mjs';

for (const value of [
  'file:///etc/passwd',
  'javascript:alert(1)',
  'http://localhost/admin',
  'http://service.internal/',
  'http://127.0.0.1/',
  'http://10.0.0.1/',
  'http://100.64.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://172.16.0.1/',
  'http://192.168.0.1/',
  'http://[::1]/',
  'http://[fd00::1]/',
  'https://user:password@example.com/',
]) {
  assert.throws(
    () => parsePublicHttpUrl(value),
    undefined,
    `Expected URL to be rejected: ${value}`,
  );
}

assert.equal(
  parsePublicHttpUrl('https://example.com/path?q=1').toString(),
  'https://example.com/path?q=1',
);
await assert.rejects(
  fetchPublicHttp('http://169.254.169.254/latest/meta-data/'),
  /private IP address/,
);

console.log('✓ public HTTP URL security checks passed');
