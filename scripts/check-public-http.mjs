import assert from 'node:assert/strict';
import {
  fetchPublicHttp,
  parsePublicHttpUrl,
  validateResolvedAddresses,
} from '../src/plugins/lib/public-http.mjs';
import { readResponseBuffer } from '../src/plugins/lib/response-body.mjs';

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
  'http://192.0.2.1/',
  'http://198.51.100.1/',
  'http://203.0.113.1/',
  'http://[::1]/',
  'http://[fd00::1]/',
  'http://[2001:db8::1]/',
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
  /non-public address/,
);

assert.throws(
  () => validateResolvedAddresses('mixed.example', [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]),
  /non-public address/,
);
assert.deepEqual(
  validateResolvedAddresses('public.example', [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ]),
  [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ],
);

await assert.rejects(
  readResponseBuffer(new Response('1234'), 3),
  /exceeds 3 bytes/,
);
assert.equal(
  (await readResponseBuffer(
    new Response('1234'),
    3,
    { allowTruncated: true },
  )).toString(),
  '123',
);

console.log('✓ public HTTP and response-size security checks passed');
