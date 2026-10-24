import { Jimp } from 'jimp';
import { ICON_SIZE, ICON_SIZES, MAX_ICON_BYTES, MAX_ICON_PIXELS, validateIconInput } from './icon-image.mjs';

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

try {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_ICON_BYTES) throw new Error('Icon exceeds the input byte limit');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const dimensions = validateIconInput(buffer);
  const image = await Jimp.fromBuffer(buffer, {
    'image/jpeg': { maxResolutionInMP: MAX_ICON_PIXELS / 1_000_000, maxMemoryUsageInMB: 64 },
  });
  if (image.bitmap.width * image.bitmap.height !== dimensions.width * dimensions.height) {
    throw new Error('Decoded icon dimensions differ from its header');
  }
  if (process.argv.includes('--variants-only')) {
    if (image.bitmap.width !== ICON_SIZE || image.bitmap.height !== ICON_SIZE) throw new Error('Invalid cached icon dimensions');
  } else {
    image.cover({ w: ICON_SIZE, h: ICON_SIZE });
    const mask = new Jimp({ width: ICON_SIZE, height: ICON_SIZE, color: 0xffffffff });
    const radius = ICON_SIZE / 2;
    for (let y = 0; y < ICON_SIZE; y++) {
      for (let x = 0; x < ICON_SIZE; x++) {
        const distance = Math.hypot(x - radius + 0.5, y - radius + 0.5);
        if (distance < radius - 1) continue;
        const value = distance >= radius ? 0 : Math.round(255 * (radius - distance));
        mask.setPixelColor(((value << 24) | (value << 16) | (value << 8) | 255) >>> 0, x, y);
      }
    }
    image.mask(mask);
  }
  const outputs = { 'icon.png': await image.getBuffer('image/png') };
  for (const size of ICON_SIZES) {
    outputs[`icon-${size}.png`] = await image.clone().resize({ w: size, h: size }).getBuffer('image/png');
  }
  const icoImages = [];
  for (const size of [16, 32, 48]) {
    icoImages.push({ size, png: await image.clone().resize({ w: size, h: size }).getBuffer('image/png') });
  }
  outputs['favicon.ico'] = buildIco(icoImages);
  process.stdout.write(JSON.stringify(Object.fromEntries(
    Object.entries(outputs).map(([name, output]) => [name, output.toString('base64')]),
  )));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
