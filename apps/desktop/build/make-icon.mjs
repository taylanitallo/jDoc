// Gerador do icone PLACEHOLDER original (256x256, roxo neon solido) em
// build/icon.ico — SUBSTITUIDO pelo icone real (Logo_executavel.png, na raiz
// do repo) a partir de 2026-07-11. Mantido so como fallback de emergencia;
// nao rodar por cima do icone.ico/icon-256.png atuais sem querer.
// PNG-in-ICO — aceito pelo Windows e pelo electron-builder.
// Uso: `node build/make-icon.mjs`.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 256;
const H = 256;
const RGB = [124, 58, 237]; // #7c3aed

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB

const row = Buffer.alloc(1 + W * 3);
for (let x = 0; x < W; x++) {
  row[1 + x * 3] = RGB[0];
  row[1 + x * 3 + 1] = RGB[1];
  row[1 + x * 3 + 2] = RGB[2];
}
const raw = Buffer.concat(Array.from({ length: H }, () => row));
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type = icon
dir.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256 -> 0
entry[1] = 0; // height 256 -> 0
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bit count
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12); // offset
const ico = Buffer.concat([dir, entry, png]);

const out = join(dirname(fileURLToPath(import.meta.url)), 'icon.ico');
writeFileSync(out, ico);
// eslint-disable-next-line no-console
console.log(`icon.ico gerado (${ico.length} bytes) em ${out}`);
