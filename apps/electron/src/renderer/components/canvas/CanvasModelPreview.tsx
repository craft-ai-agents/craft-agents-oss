import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export default function CanvasModelPreview({ path, onClose }: { path: string; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const host = container.current!
    let disposed = false, frame = 0, renderer: THREE.WebGLRenderer | undefined, controls: OrbitControls | undefined, model: THREE.Group | undefined, observer: ResizeObserver | undefined
    const release = (root: THREE.Object3D) => root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) { (value.source?.data as ImageBitmap | undefined)?.close?.(); value.dispose() }
        material.dispose()
      }
    })
    setReady(false); setError('')
    void (async () => {
      try {
        const bytes = await window.electronAPI.readFileBinary(path)
        if (disposed) return
        if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('模型文件为空或超过16MiB。')
        const manager = new THREE.LoadingManager()
        manager.setURLModifier(url => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('模型引用了外部资源，已阻止加载。'); return url })
        const loaded = await new GLTFLoader(manager).parseAsync(new Uint8Array(bytes).buffer, '')
        model = loaded.scene
        if (disposed) { release(model); return }
        const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
        const extent = Math.max(size.x, size.y, size.z)
        if (!Number.isFinite(extent) || extent <= 0) throw new Error('模型没有可显示的几何范围。')
        model.position.sub(center); model.scale.setScalar(2 / extent); model.position.multiplyScalar(2 / extent)
        const scene = new THREE.Scene(); scene.background = new THREE.Color('#20242b'); scene.add(model)
        scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7380, 3))
        const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 4, 5); scene.add(light)
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100); camera.position.set(3, 2, 3)
        renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); host.appendChild(renderer.domElement)
        controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true
        const resize = () => { const width = host.clientWidth, height = host.clientHeight; renderer!.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix() }
        observer = new ResizeObserver(resize); observer.observe(host); resize()
        const render = () => { if (disposed) return; controls!.update(); renderer!.render(scene, camera); frame = requestAnimationFrame(render) }; render(); setReady(true)
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : '3D预览加载失败，请下载GLB核对。') }
    })()
    return () => { disposed = true; cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose(); if (model) release(model); renderer?.dispose(); renderer?.domElement.remove() }
  }, [path])
  return <div role="dialog" aria-modal="true" aria-label="3D成果预览" className="fixed inset-8 z-50 flex flex-col rounded-xl border bg-background p-3 shadow-strong">
    <div className="flex items-center justify-between"><span>3D成果预览 · 拖动旋转 / 滚轮缩放</span><button className="underline" onClick={onClose}>关闭预览</button></div>
    <p className="my-2 text-xs text-muted-foreground">检查不可见面、比例与网格质量。该模型不代表工程CAD或可制造性验证。</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!ready && !error && <p role="status">正在加载本地GLB…</p>}
    <div ref={container} className="min-h-0 flex-1 overflow-hidden rounded-lg" />
  </div>
}
