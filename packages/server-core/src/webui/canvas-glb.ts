/** Structural GLB checks, not a geometric/engineering quality certification. */
export function validateCanvasGlb(bytes: Buffer) {
  const invalid = () => { throw new Error('GLB模型格式无效、没有可见网格或包含外部资源，不能作为3D成果。') }
  if (bytes.length < 28 || bytes.length > 16 * 1024 * 1024 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) invalid()
  let offset = 12, document: any, binaryLength = 0, chunks = 0
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid()
    const length = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4)
    if (length % 4 || offset + 8 + length > bytes.length) invalid()
    if (chunks === 0) {
      if (kind !== 0x4e4f534a || length > 4 * 1024 * 1024) invalid()
      try { document = JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + length)) } catch { invalid() }
    } else if (chunks === 1 && kind === 0x004e4942) binaryLength = length
    else invalid()
    offset += 8 + length; chunks++
  }
  if (!document || document.asset?.version !== '2.0' || !binaryLength || !Array.isArray(document.buffers) || document.buffers.length !== 1 || document.buffers[0]?.uri !== undefined || !Number.isSafeInteger(document.buffers[0]?.byteLength) || document.buffers[0].byteLength < 1 || document.buffers[0].byteLength > binaryLength || binaryLength - document.buffers[0].byteLength > 3) invalid()
  if (!Array.isArray(document.meshes) || !document.meshes.length || !Array.isArray(document.nodes) || !document.nodes.some((node: any) => Number.isInteger(node.mesh) && document.meshes[node.mesh]) || !document.scenes?.length) invalid()
  const scene = document.scenes[document.scene ?? 0]
  if (!Array.isArray(scene?.nodes) || !scene.nodes.length || document.nodes.length > 10000) invalid()
  const active = new Set<number>(), visited = new Set<number>(); let visibleMeshes = 0
  const visit = (id: number, depth: number) => {
    if (!Number.isInteger(id) || !document.nodes[id] || active.has(id) || depth > 128) invalid()
    if (visited.has(id)) return
    visited.add(id); active.add(id)
    const node = document.nodes[id]
    if (node.mesh !== undefined) { if (!Number.isInteger(node.mesh) || !document.meshes[node.mesh]) invalid(); visibleMeshes++ }
    if (node.children !== undefined && !Array.isArray(node.children)) invalid()
    for (const child of node.children || []) visit(child, depth + 1)
    active.delete(id)
  }
  scene.nodes.forEach((id: number) => visit(id, 0))
  if (!visibleMeshes) invalid()
  // Keep the preview offline and bounded: no external files, unknown required codecs or remote textures.
  if (document.extensionsRequired?.some((name: string) => !['KHR_materials_unlit', 'KHR_texture_transform'].includes(name))) invalid()
  for (const image of document.images || []) if (image.uri !== undefined || !Number.isInteger(image.bufferView) || !document.bufferViews?.[image.bufferView]) invalid()
  for (const view of document.bufferViews || []) if (view.buffer !== 0 || !Number.isSafeInteger(view.byteLength) || view.byteLength < 1 || !Number.isSafeInteger(view.byteOffset ?? 0) || (view.byteOffset ?? 0) < 0 || (view.byteOffset ?? 0) + view.byteLength > document.buffers[0].byteLength) invalid()
  let positions = 0
  for (const mesh of document.meshes) {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) invalid()
    for (const primitive of mesh.primitives) {
      const accessor = document.accessors?.[primitive.attributes?.POSITION]
      if (!accessor || accessor.type !== 'VEC3' || accessor.componentType !== 5126 || !Number.isSafeInteger(accessor.count) || accessor.count < 3 || !document.bufferViews?.[accessor.bufferView]) invalid()
      const view = document.bufferViews[accessor.bufferView], stride = view.byteStride ?? 12, start = accessor.byteOffset ?? 0
      if (!Number.isSafeInteger(stride) || stride < 12 || !Number.isSafeInteger(start) || start < 0 || start + (accessor.count - 1) * stride + 12 > view.byteLength) invalid()
      positions += accessor.count
    }
  }
  if (positions > 2_000_000) invalid()
  return { meshes: document.meshes.length, positions }
}
