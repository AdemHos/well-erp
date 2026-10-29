/* eslint-disable @typescript-eslint/no-require-imports -- Asset conversion utility. */
// Convert the existing WellPOS logo mark into browser and Apple icon formats.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'public/images/logo-dark.png');
  const mark = await sharp(source).extract({ left: 390, top: 150, width: 810, height: 480 }).toBuffer();
  const render = size => sharp(mark).resize(size, size, { fit: 'contain', background: '#020a12' }).png().toBuffer();
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map(render));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((buffer, i) => {
    const entry = 6 + 16 * i;
    header[entry] = sizes[i]; header[entry + 1] = sizes[i];
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += buffer.length;
  });
  await fs.writeFile(path.join(root, 'src/app/favicon.ico'), Buffer.concat([header, ...images]));
  await fs.writeFile(path.join(root, 'public/images/favicon-192.png'), await render(192));
  await fs.writeFile(path.join(root, 'public/images/apple-touch-icon.png'), await render(180));
  console.log('WellPOS favicon generated (16, 32, 48, 180, 192 px).');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
