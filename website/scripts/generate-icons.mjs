/**
 * Generate Torah Tai Chi favicon set from the brand SVG.
 * Run: node scripts/generate-icons.mjs
 * Requires: npm install -D sharp
 */

import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

// Brand mark SVG (navy bg, circular brand mark)
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#1F2C4B"/>
  <g transform="translate(256 256) scale(3.7)">
    <defs>
      <radialGradient id="cw" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#E3B888"/>
        <stop offset="45%" stop-color="#B8823A"/>
        <stop offset="100%" stop-color="#6A4622"/>
      </radialGradient>
      <radialGradient id="ll" cx="40%" cy="35%" r="80%">
        <stop offset="0%" stop-color="#FAF4E8"/>
        <stop offset="100%" stop-color="#E9DDC1"/>
      </radialGradient>
      <radialGradient id="nl" cx="60%" cy="60%" r="80%">
        <stop offset="0%" stop-color="#2B3A5C"/>
        <stop offset="100%" stop-color="#131E38"/>
      </radialGradient>
    </defs>
    <circle r="42" fill="url(#cw)" stroke="#3D2A14" stroke-width=".8"/>
    <circle r="34" fill="none" stroke="#3D2A14" stroke-width=".4" opacity=".5"/>
    <circle r="28" fill="url(#ll)"/>
    <path d="M 0,-28 A 28,28 0 0,0 0,28 A 14,14 0 0,1 0,0 A 14,14 0 0,0 0,-28 Z" fill="url(#nl)"/>
    <circle cx="0" cy="-14" r="3.2" fill="#FAF4E8"/>
    <circle cx="0" cy="14" r="3.2" fill="#2B3A5C"/>
    <g transform="translate(0,-14) scale(.55)">
      <polygon points="0,-8 6.93,4 -6.93,4" fill="none" stroke="#9E7A3A" stroke-width="1.2"/>
      <polygon points="0,8 6.93,-4 -6.93,-4" fill="none" stroke="#9E7A3A" stroke-width="1.2"/>
    </g>
  </g>
</svg>`;

const svgBuffer = Buffer.from(SVG);

async function generate() {
  const sizes = [
    { file: 'favicon-16x16.png',         size: 16  },
    { file: 'favicon-32x32.png',         size: 32  },
    { file: 'apple-touch-icon.png',      size: 180 },
    { file: 'android-chrome-192x192.png', size: 192 },
    { file: 'android-chrome-512x512.png', size: 512 },
  ];

  for (const { file, size } of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(PUBLIC, file));
    console.log(`Generated ${file}`);
  }

  // favicon.ico: embed the 32x32 PNG (ICO with single 32x32 frame)
  const png32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer();
  // Write a minimal ICO: ICO header + dir entry + PNG data (modern browsers accept PNG-in-ICO)
  const ico = buildIco([png32]);
  writeFileSync(join(PUBLIC, 'favicon.ico'), ico);
  console.log('Generated favicon.ico');

  console.log('Done.');
}

/**
 * Build a minimal ICO file that embeds one PNG frame.
 * Modern browsers, macOS, and Windows all accept PNG frames in ICO files.
 */
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dataOffset = headerSize + dirEntrySize * count;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type: 1 = ICO
  header.writeUInt16LE(count, 4); // Image count

  const dirEntries = [];
  let offset = dataOffset;
  for (const png of pngBuffers) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(32, 0);               // Width (0 = 256+; 32 here)
    entry.writeUInt8(32, 1);               // Height
    entry.writeUInt8(0, 2);               // Color count (0 = true color)
    entry.writeUInt8(0, 3);               // Reserved
    entry.writeUInt16LE(1, 4);            // Color planes
    entry.writeUInt16LE(32, 6);           // Bits per pixel
    entry.writeUInt32LE(png.length, 8);   // Data size
    entry.writeUInt32LE(offset, 12);      // Data offset
    dirEntries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers]);
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
