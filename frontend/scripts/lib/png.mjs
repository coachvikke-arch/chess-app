import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * Minimal PNG decode / encode.
 *
 * The certificate work needs to read and rewrite the template artwork (to erase
 * the placeholder name before the real one is drawn on top) and the project has
 * no image library — no sharp, no jimp. So this implements just enough of the
 * format: parse IHDR, concatenate IDAT, inflate, undo the scanline filters; and
 * for writing, filter type 0 plus a deflate.
 *
 * Only 8-bit non-interlaced greyscale/RGB/RGBA are handled, which is what the
 * template is. Anything else throws rather than silently producing wrong pixels.
 */

export function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);

  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error(`${file}: no IHDR`);
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  if (bitDepth !== 8) throw new Error(`${file}: unsupported bit depth ${bitDepth}`);
  if (interlace) throw new Error(`${file}: interlaced PNG not supported`);
  if (colorType === 3) throw new Error(`${file}: palette PNG not supported`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${file}: unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  /* Undo the per-scanline filters (PNG spec section 9.2). */
  let rp = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rp];
    rp += 1;
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
          break;
        }
        default: throw new Error(`${file}: bad filter ${filter} on row ${y}`);
      }
      cur[i] = v & 0xff;
    }
  }

  return {
    width, height, channels, data: out,
    at(x, y) {
      const i = y * stride + x * bpp;
      if (channels >= 3) return { r: out[i], g: out[i + 1], b: out[i + 2], a: channels === 4 ? out[i + 3] : 255 };
      return { r: out[i], g: out[i], b: out[i], a: 255 };
    },
    set(x, y, r, g, b) {
      const i = y * stride + x * bpp;
      if (channels >= 3) { out[i] = r; out[i + 1] = g; out[i + 2] = b; }
      else { out[i] = r; }
    },
  };
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** Encode an RGB buffer (width * height * 3) as an 8-bit truecolour PNG. */
export function encodePng(rgb, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An RGB buffer sized for a decoded image, so it can be re-encoded. */
export function toRgb(img) {
  const out = Buffer.alloc(img.width * img.height * 3);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const p = img.at(x, y);
      const i = (y * img.width + x) * 3;
      out[i] = p.r; out[i + 1] = p.g; out[i + 2] = p.b;
    }
  }
  return out;
}