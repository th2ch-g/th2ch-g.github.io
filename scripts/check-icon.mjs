import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Jimp } from 'jimp';
import { ICON_SIZES, MAX_ICON_BYTES, renderIcon, validateIconInput } from './lib/icon-image.mjs';

const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, '.cache'), { recursive: true });
const scratch = mkdtempSync(join(root, '.cache/icon-check-'));

function pngChunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, 'ascii');
  data.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function tinyPng(base, { interlace = 0, bytes = 5, duplicate = false } = {}) {
  const header = Buffer.from(base.subarray(16, 29));
  header[12] = interlace;
  const ihdr = pngChunk('IHDR', header);
  return Buffer.concat([
    base.subarray(0, 8), ihdr, ...(duplicate ? [ihdr] : []),
    pngChunk('IDAT', deflateSync(Buffer.alloc(bytes))), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

try {
  const source = new Jimp({ width: 16, height: 8, color: 0x225599ff });
  const png = await source.getBuffer('image/png');
  for (const mime of ['image/png', 'image/jpeg', 'image/bmp']) {
    const outputs = await renderIcon(await source.clone().getBuffer(mime));
    assert.equal(outputs.size, ICON_SIZES.length + 2);
    const master = await Jimp.fromBuffer(outputs.get('icon.png'));
    assert.equal(master.bitmap.width, 256);
    assert.equal(master.bitmap.height, 256);
    assert.equal(master.getPixelColor(0, 0) & 255, 0);
    assert.equal(master.getPixelColor(128, 128) & 255, 255);
  }
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  assert.equal((await renderIcon(gif)).size, ICON_SIZES.length + 2);
  const badFrame = Buffer.from(gif);
  badFrame.writeUInt16LE(4097, badFrame.indexOf(0x2c, 19) + 5);
  assert.throws(() => validateIconInput(badFrame), /pixel limit/);

  for (const [width, height] of [[4097, 1], [2048, 2048], [0, 1]]) {
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(width, 16);
    oversized.writeUInt32BE(height, 20);
    assert.throws(() => validateIconInput(oversized), /pixel limit/);
    await assert.rejects(renderIcon(oversized), /pixel limit/);
  }
  await assert.rejects(renderIcon(Buffer.alloc(MAX_ICON_BYTES + 1)), /byte limit/);
  await assert.rejects(renderIcon(Buffer.from('invalid image')));

  const pixel = await new Jimp({ width: 1, height: 1, color: 0x112233ff }).getBuffer('image/png');
  assert.equal((await renderIcon(tinyPng(pixel, { interlace: 1 }))).size, ICON_SIZES.length + 2);
  assert.throws(() => validateIconInput(tinyPng(pixel, { interlace: 1, bytes: 6 })), /larger|size|length/i);
  assert.throws(() => validateIconInput(tinyPng(pixel, { duplicate: true })), /header order/);

  const hanging = join(scratch, 'hanging.mjs');
  const pidFile = join(scratch, 'worker.pid');
  writeFileSync(hanging, `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`);
  await assert.rejects(renderIcon(png, { worker: pathToFileURL(hanging), timeout: 1000 }), /time or output limit/);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });

  const fixture = join(scratch, 'fixture');
  for (const dir of ['scripts/lib', 'src/plugins/lib', 'src/lib', 'src/content', 'public']) {
    mkdirSync(join(fixture, dir), { recursive: true });
  }
  for (const path of ['scripts/build-icon.mjs', 'scripts/lib/icon-image.mjs', 'scripts/lib/icon-worker.mjs', 'src/plugins/lib/response-body.mjs']) {
    copyFileSync(join(root, path), join(fixture, path));
  }
  writeFileSync(join(fixture, 'src/content/profile.yaml'), 'icon: fixture\n');
  writeFileSync(join(fixture, 'src/lib/profile-yaml.mjs'), "export async function iconUrl() { return 'https://example.test/avatar.png'; }\n");
  writeFileSync(join(fixture, 'src/plugins/lib/public-http.mjs'), "import { readFileSync } from 'node:fs';\nexport async function fetchPublicHttp() { return new Response(readFileSync(process.env.CHECK_ICON_INPUT)); }\n");
  const input = join(scratch, 'input.bin');
  const run = () => execFileSync(process.execPath, [join(fixture, 'scripts/build-icon.mjs'), '--force'], {
    env: { CHECK_ICON_INPUT: input }, timeout: 35_000, encoding: 'utf8', stdio: 'pipe',
  });
  writeFileSync(input, png);
  run();
  const names = ['icon.png', 'favicon.ico', ...ICON_SIZES.map((size) => `icon-${size}.png`)];
  const before = new Map(names.map((name) => [name, readFileSync(join(fixture, 'public', name))]));
  writeFileSync(input, 'invalid image');
  run();
  for (const name of names) assert.deepEqual(readFileSync(join(fixture, 'public', name)), before.get(name));
  unlinkSync(join(fixture, 'public/icon-96.png'));
  run();
  for (const name of names) assert.deepEqual(readFileSync(join(fixture, 'public', name)), before.get(name));
  console.log('[icon] Pixel limits, PNG expansion bounds, worker termination, and fallback preservation passed');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
