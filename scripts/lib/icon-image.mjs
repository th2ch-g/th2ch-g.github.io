import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { imageSize } from 'image-size';

export const MAX_ICON_BYTES = 4 * 1024 * 1024;
export const MAX_ICON_PIXELS = 4_000_000;
export const ICON_SIZE = 256;
export const ICON_SIZES = [32, 64, 96, 128, 180];
const MAX_EDGE = 4096;
const WORKER = new URL('./icon-worker.mjs', import.meta.url);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IMAGE_SIZES = new Map([
  ['icon.png', ICON_SIZE],
  ...ICON_SIZES.map((size) => [`icon-${size}.png`, size]),
]);

function checkDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
      || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_ICON_PIXELS) {
    throw new Error('Icon exceeds the dimension or pixel limit');
  }
}

function checkPng(buffer, width, height) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Invalid PNG signature');
  let offset = 8;
  let header = false;
  let ended = false;
  let depth;
  let channels;
  let interlace;
  const parts = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > buffer.length) throw new Error('Truncated PNG chunk');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      if (header || offset !== 8 || length !== 13) throw new Error('Invalid PNG header order');
      header = true;
      depth = buffer[offset + 16];
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[buffer[offset + 17]];
      interlace = buffer[offset + 20];
      if (!channels || ![1, 2, 4, 8, 16].includes(depth) || interlace > 1) throw new Error('Unsupported PNG layout');
    } else if (!header) {
      throw new Error('Missing PNG header');
    } else if (type === 'IDAT') {
      parts.push(buffer.subarray(offset + 8, end - 4));
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('Invalid PNG end marker');
      ended = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!ended || offset !== buffer.length || parts.length === 0) throw new Error('Incomplete PNG');
  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  let inflatedLimit = 0;
  for (const [x, y, dx, dy] of passes) {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const rows = Math.max(0, Math.ceil((height - y) / dy));
    if (columns && rows) inflatedLimit += (Math.ceil(columns * channels * depth / 8) + 1) * rows;
  }
  // pngjs's interlaced path inflates synchronously without an output budget.
  const inflated = inflateSync(Buffer.concat(parts), { maxOutputLength: inflatedLimit });
  if (inflated.length !== inflatedLimit) throw new Error('PNG scanline size does not match its dimensions');
}

function checkGifFrame(buffer, width, height) {
  let offset = 13 + ((buffer[10] & 128) ? 3 * (2 ** ((buffer[10] & 7) + 1)) : 0);
  while (offset < buffer.length) {
    const tag = buffer[offset++];
    if (tag === 0x2c) {
      if (offset + 9 > buffer.length) throw new Error('Truncated GIF frame');
      const left = buffer.readUInt16LE(offset);
      const top = buffer.readUInt16LE(offset + 2);
      const frameWidth = buffer.readUInt16LE(offset + 4);
      const frameHeight = buffer.readUInt16LE(offset + 6);
      checkDimensions(frameWidth, frameHeight);
      if (left + frameWidth > width || top + frameHeight > height) throw new Error('GIF frame exceeds its canvas');
      return;
    }
    if (tag !== 0x21) throw new Error('GIF has no supported first frame');
    offset++;
    let length;
    do {
      if (offset >= buffer.length) throw new Error('Truncated GIF extension');
      length = buffer[offset++];
      offset += length;
    } while (length);
  }
  throw new Error('Missing GIF frame');
}

export function validateIconInput(buffer) {
  if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) throw new Error('Icon exceeds the input byte limit');
  const { width, height, type } = imageSize(buffer);
  if (!['png', 'jpg', 'gif', 'bmp'].includes(type)) {
    throw new Error('Icon must be PNG, JPEG, GIF, or BMP');
  }
  checkDimensions(width, height);
  if (type === 'png') checkPng(buffer, width, height);
  if (type === 'gif') checkGifFrame(buffer, width, height);
  if (type === 'bmp' && (buffer.length < 54 || buffer.readUInt32LE(14) < 40)) {
    throw new Error('Unsupported BMP header');
  }
  return { width, height, type };
}

function readOutputs(stdout) {
  const encoded = JSON.parse(stdout);
  const names = [...IMAGE_SIZES.keys(), 'favicon.ico'];
  if (!encoded || typeof encoded !== 'object' || Array.isArray(encoded)
      || Object.keys(encoded).length !== names.length) throw new Error('Invalid icon worker output');
  const outputs = new Map();
  for (const name of names) {
    if (typeof encoded[name] !== 'string') throw new Error('Missing icon worker output');
    const buffer = Buffer.from(encoded[name], 'base64');
    if (!buffer.length || buffer.length > MAX_ICON_BYTES) throw new Error('Invalid icon output size');
    if (IMAGE_SIZES.has(name)) {
      const dimensions = imageSize(buffer);
      const size = IMAGE_SIZES.get(name);
      if (dimensions.type !== 'png' || dimensions.width !== size || dimensions.height !== size) {
        throw new Error('Invalid generated icon dimensions');
      }
    } else if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1
        || buffer.readUInt16LE(4) !== 3) {
      throw new Error('Invalid generated favicon');
    }
    outputs.set(name, buffer);
  }
  return outputs;
}

export function renderIcon(buffer, { variantsOnly = false, timeout = 15_000, worker = WORKER } = {}) {
  if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) return Promise.reject(new Error('Icon exceeds the input byte limit'));
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [
      '--max-old-space-size=128', fileURLToPath(worker), ...(variantsOnly ? ['--variants-only'] : []),
    ], {
      timeout, killSignal: 'SIGKILL', maxBuffer: MAX_ICON_BYTES, env: {}, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(error.killed ? 'Icon processing exceeded its time or output limit' : (stderr.trim() || error.message)));
        return;
      }
      try {
        resolve(readOutputs(stdout));
      } catch (failure) {
        reject(failure);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(buffer);
  });
}
