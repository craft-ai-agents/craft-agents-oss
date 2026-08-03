import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))

const SIZES = [16, 32, 48, 64, 128, 256]

async function main() {
  const svgPath = join(__dirname, "icon.svg")
  const svgBuffer = readFileSync(svgPath)

  // Generate 512x512 PNG for Linux / source
  const pngBuffer512 = await sharp(svgBuffer, { density: 288 })
    .resize(512, 512, { fit: "contain", background: { r: 17, g: 17, b: 17, alpha: 1 } })
    .png()
    .toBuffer()

  writeFileSync(join(__dirname, "icon.png"), pngBuffer512)
  console.log("Generated icon.png (512x512)")

  // Generate multi-size ICO (Windows)
  const images = await Promise.all(
    SIZES.map(async (size) => {
      const buf = await sharp(svgBuffer, { density: 288 })
        .resize(size, size, { fit: "contain", background: { r: 17, g: 17, b: 17, alpha: 1 } })
        .png()
        .toBuffer()
      return { size, buf }
    })
  )

  const icoBuffer = buildIco(images)
  writeFileSync(join(__dirname, "icon.ico"), icoBuffer)
  console.log("Generated icon.ico")

  // source.png used by the macOS script
  writeFileSync(join(__dirname, "source.png"), pngBuffer512)
  console.log("Generated source.png")

  console.log("\nNote: icon.icns for macOS is NOT generated here. On a Mac, run:")
  console.log("  cd apps/electron/resources && ./generate-icons.sh source.png")
  console.log("Or regenerate icon.icns before a macOS packaged build.")
}

function buildIco(images) {
  const count = images.length
  const headerSize = 6 + count * 16
  let offset = headerSize
  const parts = []

  // ICONDIR
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // Reserved
  header.writeUInt16LE(1, 2) // Type: ICO
  header.writeUInt16LE(count, 4) // Count

  images.forEach(({ size, buf }, i) => {
    const dirOffset = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, dirOffset + 0) // Width
    header.writeUInt8(size >= 256 ? 0 : size, dirOffset + 1) // Height
    header.writeUInt8(0, dirOffset + 2) // Color palette
    header.writeUInt8(0, dirOffset + 3) // Reserved
    header.writeUInt16LE(1, dirOffset + 4) // Color planes
    header.writeUInt16LE(32, dirOffset + 6) // Bits per pixel
    header.writeUInt32LE(buf.length, dirOffset + 8) // Size of image data
    header.writeUInt32LE(offset, dirOffset + 12) // Offset
    offset += buf.length
    parts.push(buf)
  })

  return Buffer.concat([header, ...parts])
}

main().catch((err) => {
  console.error("Icon generation failed:", err)
  process.exit(1)
})
