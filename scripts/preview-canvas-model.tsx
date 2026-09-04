/** Local visual QA only: renders the production GLB component with an explicit synthetic fixture. */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CanvasModelPreview from '../apps/electron/src/renderer/components/canvas/CanvasModelPreview'

const documentFixture = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.25, 0.65, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: true }], buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] }
const json = new TextEncoder().encode(JSON.stringify(documentFixture)), length = Math.ceil(json.length / 4) * 4, bytes = new Uint8Array(12 + 8 + length + 8 + 36), view = new DataView(bytes.buffer)
bytes.set([103, 108, 84, 70]); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true); view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + length); bytes.set(json, 20)
view.setUint32(20 + length, 36, true); view.setUint32(24 + length, 0x004e4942, true); view.setFloat32(28 + length + 12, 1, true); view.setFloat32(28 + length + 28, 1, true)
window.electronAPI = { readFileBinary: async () => bytes } as typeof window.electronAPI
function App() { const [open, setOpen] = useState(true); return <><p>本地3D预览测试夹具（三角形，不是生成成果）</p><button onClick={() => setOpen(true)}>打开测试预览</button>{open && <CanvasModelPreview path="synthetic-triangle.glb" onClose={() => setOpen(false)} />}</> }
createRoot(document.getElementById('root')!).render(<App />)
