import * as React from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface OutputModelPreviewProps {
  url: string
  label: string
  className?: string
  onPreviewSettled?: (status: 'ready' | 'error') => void
}

export function OutputModelPreview({
  url,
  label,
  className,
  onPreviewSettled,
}: OutputModelPreviewProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const resetRef = React.useRef<(() => void) | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = React.useState<string>('Loading model...')

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x050505)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'WebGL is unavailable for this model preview.')
      onPreviewSettled?.('error')
      return () => { disposed = true }
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.domElement.setAttribute('aria-label', label)
    renderer.domElement.className = 'h-full w-full'
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1b1b1b, 1.6))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(4, 5, 6)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x8fb8ff, 0.8)
    fillLight.position.set(-4, 2, -3)
    scene.add(fillLight)

    const grid = new THREE.GridHelper(10, 20, 0x2f3541, 0x151922)
    grid.material.opacity = 0.32
    grid.material.transparent = true
    scene.add(grid)

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)

    let animation = 0
    const animate = () => {
      if (disposed) return
      controls.update()
      renderer.render(scene, camera)
      animation = window.requestAnimationFrame(animate)
    }
    animate()

    const loader = new GLTFLoader()
    setState('loading')
    setMessage('Loading model...')
    try {
      loader.load(
        url,
        (gltf) => {
          if (disposed) return
          const object = gltf.scene
          scene.add(object)
          frameObject(object, camera, controls, grid)
          resetRef.current = () => frameObject(object, camera, controls, grid)
          setState('ready')
          setMessage('')
          onPreviewSettled?.('ready')
        },
        undefined,
        (error) => {
          if (disposed) return
          setState('error')
          setMessage(error instanceof Error ? error.message : 'Model failed to load.')
          onPreviewSettled?.('error')
        },
      )
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'Model failed to load.')
      onPreviewSettled?.('error')
    }

    return () => {
      disposed = true
      window.cancelAnimationFrame(animation)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      resetRef.current = null
      while (host.firstChild) host.removeChild(host.firstChild)
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((material) => material?.dispose())
      })
    }
  }, [label, onPreviewSettled, url])

  return (
    <div className={cn('relative h-full min-h-[260px] w-full overflow-hidden rounded-md bg-black', className)}>
      <div ref={hostRef} className="absolute inset-0" />
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/72 px-4 text-sm text-white/62">
          <div className="flex items-center gap-2">
            {state === 'error' && <AlertTriangle className="h-4 w-4 text-red-300" />}
            <span className="max-w-[34rem] text-center">{message}</span>
          </div>
        </div>
      )}
      {state === 'ready' && (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute right-3 top-3 h-8 w-8 bg-black/45 text-white/78 hover:bg-black/65"
          aria-label="Reset model view"
          onClick={() => resetRef.current?.()}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

function frameObject(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  grid: THREE.GridHelper,
) {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const distance = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.45

  object.position.sub(center)
  const framedBox = new THREE.Box3().setFromObject(object)
  const framedSize = framedBox.getSize(new THREE.Vector3())
  const framedCenter = framedBox.getCenter(new THREE.Vector3())
  const framedMax = Math.max(framedSize.x, framedSize.y, framedSize.z, 1)

  camera.near = Math.max(0.01, distance / 100)
  camera.far = Math.max(1000, distance * 100)
  camera.position.set(framedCenter.x + framedMax * 0.85, framedCenter.y + framedMax * 0.55, framedCenter.z + distance)
  camera.lookAt(framedCenter)
  camera.updateProjectionMatrix()

  controls.target.copy(framedCenter)
  controls.minDistance = Math.max(0.01, framedMax * 0.08)
  controls.maxDistance = Math.max(10, framedMax * 12)
  controls.update()

  grid.scale.setScalar(Math.max(1, framedMax / 4))
  grid.position.y = framedBox.min.y
}
