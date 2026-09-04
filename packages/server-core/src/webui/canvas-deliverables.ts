import { createHash, randomUUID } from 'node:crypto'
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CanvasReview } from '@craft-agent/session-tools-core/canvas-review'
import { validateCanvasGlb } from './canvas-glb'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Recheck the exact immutable version before review/handoff; never accept paths from the renderer. */
export function inspectCanvasDeliverables(sessionPath: string, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('无效的成果版本。')
  const root = realpathSync(sessionPath), data = join(root, 'data'), destination = join(data, `canvas-result-${revision}`)
  for (const path of [data, destination]) if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw new Error('成果目录已变化或不可读，请核对原任务。')
  const safeFile = (name: string, maxBytes: number) => {
    const path = join(destination, name), stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile() || !stat.size || stat.size > maxBytes) throw new Error('成果文件缺失、过大或不是普通文件，不能批准。')
    return readFileSync(path)
  }
  const receipt = safeFile('receipt.json', 64_000)
  const files: Array<{ name: string; sha256: string }> = JSON.parse(receipt.toString('utf8'))
  if (!Array.isArray(files) || !files.length || files.length > 20 || new Set(files.map(item => item?.name)).size !== files.length) throw new Error('成果清单无效。')
  let total = 0
  for (const file of files) {
    if (!file || !/^\d{2}\.(png|jpg|webp|md|glb|json)$/.test(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('成果清单包含无效文件。')
    const bytes = safeFile(file.name, 16 * 1024 * 1024)
    total += bytes.length
    if (total > 32 * 1024 * 1024 || hash(bytes) !== file.sha256) throw new Error('成果文件已被修改，不能按旧版本批准或继续。请生成新的版本。')
  }
  return { destination, digest: hash(receipt), files: files.map(file => join(destination, file.name)) }
}

export function publishCanvasReview(sessionPath: string, revision: number, review: CanvasReview) {
  const { destination, digest } = inspectCanvasDeliverables(sessionPath, revision)
  if (review.artifactDigest !== digest || !Number.isSafeInteger(review.version) || review.version < 1) throw new Error('审查记录与成果版本不一致。')
  const path = join(destination, `review-${review.version}.json`)
  const content = JSON.stringify({ schemaVersion: 1, revision, ...review }, null, 2)
  const staging = join(realpathSync(sessionPath), '.canvas-staging')
  if (existsSync(staging) && (lstatSync(staging).isSymbolicLink() || !lstatSync(staging).isDirectory())) throw new Error('Unsafe staging directory')
  mkdirSync(staging, { recursive: true })
  const temporary = join(staging, `review-${randomUUID()}.tmp`)
  writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
  // Publish the completed record exclusively; never expose a partially written review.
  try { linkSync(temporary, path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 64_000 || readFileSync(path, 'utf8') !== content) throw new Error('审查记录发生冲突，已停止覆盖。')
  } finally { unlinkSync(temporary) }
  return path
}

/** Publish immutable per-delivery files; renderer never chooses a filesystem path or filename. */
export function publishCanvasDeliverables(sessionPath: string, revision: number, artifacts: unknown) {
  if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(artifacts) || !artifacts.length || artifacts.length > 20) throw new Error('Invalid canvas deliverables')
  let total = 0
  const files = artifacts.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid canvas artifact')
    let bytes: Buffer, extension: string
    if (item.mimeType === 'text/markdown' && typeof item.text === 'string' && item.text.trim() && item.text.length <= 512_000) {
      bytes = Buffer.from(item.text); extension = 'md'
    } else if (item.mimeType === 'application/json' && typeof item.text === 'string' && item.text.length <= 128_000) {
      JSON.parse(item.text); bytes = Buffer.from(item.text); extension = 'json'
    } else {
      if (typeof item.base64 !== 'string' || !item.base64.length || item.base64.length > 23_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.base64)) throw new Error('Invalid image payload')
      bytes = Buffer.from(item.base64, 'base64')
      if (bytes.toString('base64') !== item.base64) throw new Error('Invalid image encoding')
      if (item.mimeType === 'model/gltf-binary') { validateCanvasGlb(bytes); extension = 'glb' }
      else if (item.mimeType === 'image/png' && bytes.length > 32 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') extension = 'png'
      else if (item.mimeType === 'image/jpeg' && bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) extension = 'jpg'
      else if (item.mimeType === 'image/webp' && bytes.length > 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) extension = 'webp'
      else throw new Error('图片格式与内容不匹配，仅支持 PNG、JPEG、WebP。')
    }
    total += bytes.length
    if (bytes.length > 16 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('成果超出大小限制，请分批导出。')
    return { name: `${String(index + 1).padStart(2, '0')}.${extension}`, bytes, sha256: hash(bytes) }
  })
  const root = realpathSync(sessionPath)
  const data = join(root, 'data')
  if (existsSync(data) && (lstatSync(data).isSymbolicLink() || !lstatSync(data).isDirectory())) throw new Error('Unsafe session output directory')
  mkdirSync(data, { recursive: true })
  const destination = join(data, `canvas-result-${revision}`)
  const expected = JSON.stringify(files.map(({ name, sha256 }) => ({ name, sha256 })))
  if (!existsSync(destination)) {
    // Staging must stay OUTSIDE data/: the artifact sidebar recursively lists data files.
    const staging = join(root, '.canvas-staging')
    if (existsSync(staging) && (lstatSync(staging).isSymbolicLink() || !lstatSync(staging).isDirectory())) throw new Error('Unsafe staging directory')
    mkdirSync(staging, { recursive: true })
    const temporary = join(staging, `${revision}-${randomUUID()}.tmp`)
    mkdirSync(temporary)
    for (const file of files) writeFileSync(join(temporary, file.name), file.bytes, { flag: 'wx', mode: 0o600 })
    writeFileSync(join(temporary, 'receipt.json'), expected, { flag: 'wx', mode: 0o600 })
    writeFileSync(join(temporary, '成果预览.md'), `# 画布生成成果\n\n状态：已生成，待用户审查；不代表设计质量已通过或最终定稿。\n\n${files.map(file => /\.(md|json|glb)$/.test(file.name) ? `[查看/下载 ${file.name}](./${file.name})` : `![生成图片 ${file.name}](./${file.name})`).join('\n\n')}\n`, { flag: 'wx', mode: 0o600 })
    try { renameSync(temporary, destination) } catch (error) {
      // A concurrent identical receipt may have won. Never overwrite; leave staging for diagnosis.
      if (!existsSync(destination)) throw error
    }
  }
  if (lstatSync(destination).isSymbolicLink() || !lstatSync(destination).isDirectory()) throw new Error('Unsafe output destination')
  for (const name of ['receipt.json', '成果预览.md', ...files.map(file => file.name)]) {
    if (lstatSync(join(destination, name)).isSymbolicLink() || !lstatSync(join(destination, name)).isFile()) throw new Error('Unsafe output file')
  }
  if (readFileSync(join(destination, 'receipt.json'), 'utf8') !== expected || files.some(file => hash(readFileSync(join(destination, file.name))) !== file.sha256)) throw new Error('成果版本冲突，已停止覆盖，请保留现有文件并核对。')
  return { previewPath: join(destination, '成果预览.md'), files: files.map(file => join(destination, file.name)) }
}
