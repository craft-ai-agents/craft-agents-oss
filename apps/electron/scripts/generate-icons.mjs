import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resourcesDir = resolve(__dirname, "..", "resources");

const svgBuffer = readFileSync(resolve(resourcesDir, "icon.svg"));

const BACKGROUND = { r: 17, g: 17, b: 17, alpha: 1 };

/**
 * Build a multi-size ICO file from an array of PNG buffers.
 * Each entry: { size: number, png: Buffer }
 */
function buildIco(pngs) {
  const count = pngs.length;
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = count * entrySize;
  const header = Buffer.alloc(headerSize);

  // ICONDIR
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: Icon
  header.writeUInt16LE(count, 4);

  let dataOffset = headerSize + directorySize;
  const entries = Buffer.alloc(directorySize);
  const dataBuffers = [];

  for (let i = 0; i < count; i++) {
    const { size, png } = pngs[i];
    const width = size === 256 ? 0 : size;
    const height = width;

    const entryOffset = i * entrySize;
    entries.writeUInt8(width, entryOffset); // Width (0 means 256)
    entries.writeUInt8(height, entryOffset + 1); // Height
    entries.writeUInt8(0, entryOffset + 2); // Color count (0 = >256)
    entries.writeUInt8(0, entryOffset + 3); // Reserved
    entries.writeUInt16LE(1, entryOffset + 4); // Color planes
    entries.writeUInt16LE(32, entryOffset + 6); // Bits per pixel
    entries.writeUInt32LE(png.length, entryOffset + 8); // Image size
    entries.writeUInt32LE(dataOffset, entryOffset + 12); // Offset

    dataBuffers.push(png);
    dataOffset += png.length;
  }

  return Buffer.concat([header, entries, ...dataBuffers]);
}

/**
 * Build a macOS ICNS file from an array of { type, png } entries.
 */
function buildIcns(icons) {
  const headerSize = 8;
  let body = Buffer.alloc(0);

  for (const { type, png } of icons) {
    const entry = Buffer.alloc(8);
    entry.write(type, 0, 4, "ascii");
    entry.writeUInt32LE(8 + png.length, 4);
    body = Buffer.concat([body, entry, png]);
  }

  const header = Buffer.alloc(headerSize);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32LE(headerSize + body.length, 4);

  return Buffer.concat([header, body]);
}

async function generate() {
  const sizes = [16, 32, 256];
  const pngs = [];

  for (const size of sizes) {
    const png = await sharp(svgBuffer, { density: size >= 128 ? 288 : 96 })
      .resize(size, size, {
        fit: "contain",
        background: BACKGROUND,
      })
      .png()
      .toBuffer();
    pngs.push({ size, png });
  }

  // 512×512 PNG for Linux / general use
  await sharp(svgBuffer, { density: 288 })
    .resize(512, 512, {
      fit: "contain",
      background: BACKGROUND,
    })
    .png()
    .toFile(resolve(resourcesDir, "icon.png"));

  console.log("Generated icon.png");

  // Multi-size ICO for Windows
  const icoBuffer = buildIco(pngs);
  writeFileSync(resolve(resourcesDir, "icon.ico"), icoBuffer);

  console.log("Generated icon.ico");

  // macOS ICNS
  const icnsIcons = [
    { type: "icp4", png: await getPng(16) },
    { type: "icp5", png: await getPng(32) },
    { type: "icp6", png: await getPng(128) },
    { type: "ic08", png: await getPng(256) },
    { type: "ic09", png: await getPng(512) },
  ];
  const icnsBuffer = buildIcns(icnsIcons);
  writeFileSync(resolve(resourcesDir, "icon.icns"), icnsBuffer);

  console.log("Generated icon.icns");
}

async function getPng(size) {
  return sharp(svgBuffer, { density: size >= 128 ? 288 : 96 })
    .resize(size, size, { fit: "contain", background: BACKGROUND })
    .png()
    .toBuffer();
}

generate().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
