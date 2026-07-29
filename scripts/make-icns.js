#!/usr/bin/env node
// Build a minimal but valid macOS .icns from a single PNG.
// Works on any platform (no iconutil needed). Maps 256x256 PNG -> 'ic08' entry.
const fs = require('fs');
const src = process.argv[2] || 'assets/icon.png';
const out = process.argv[3] || 'assets/icon.icns';
const png = fs.readFileSync(src);
if (!png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
  console.error('Source is not a PNG:', src);
  process.exit(1);
}
const entryType = 'ic08'; // 256x256 PNG
const entryHeader = Buffer.alloc(8);
entryHeader.write(entryType, 0, 'ascii');
entryHeader.writeUInt32BE(8 + png.length, 4);
const entry = Buffer.concat([entryHeader, png]);
const fileHeader = Buffer.alloc(8);
fileHeader.write('icns', 0, 'ascii');
fileHeader.writeUInt32BE(8 + entry.length, 4);
fs.writeFileSync(out, Buffer.concat([fileHeader, entry]));
console.log('Wrote', out, '(' + (8 + entry.length) + ' bytes, single ic08 256x256 PNG)');
