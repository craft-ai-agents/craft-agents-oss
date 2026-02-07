import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Bayer Dithering Background
 *
 * A WebGL shader background that creates an animated Bayer-dithered pattern.
 * Based on the Codrops tutorial: https://tympanus.net/codrops/2025/07/30/interactive-webgl-backgrounds-a-quick-guide-to-bayer-dithering/
 *
 * Features:
 * - Animated noise pattern using fractional Brownian motion (fBM)
 * - Ordered dithering via Bayer matrices for halftone-style output
 * - Interactive ripple effects on click
 * - Configurable shape types (squares, circles, triangles, diamonds)
 */

// Vertex shader - fullscreen triangle using Three.js built-in position attribute
// Note: Three.js adds #version 300 es when glslVersion: THREE.GLSL3 is set
const vertexShader = `
in vec3 position;

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Fragment shader - Bayer dithering with noise and ripple effects
// Using GLSL3 syntax (out instead of gl_FragColor) - Three.js adds #version directive
const fragmentShader = `
precision highp float;

uniform vec3 uColor;
uniform vec3 uBgColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform int uShapeType;

out vec4 fragColor;

// Bayer matrix for ordered dithering
float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

float Bayer4(vec2 a) {
  return Bayer2(0.5 * a) * 0.25 + Bayer2(a);
}

float Bayer8(vec2 a) {
  return Bayer4(0.5 * a) * 0.25 + Bayer2(a);
}

// Simple hash function
float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

// 3D noise
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n = i.x + i.y * 57.0 + i.z * 113.0;
  return mix(
    mix(mix(hash(n), hash(n + 1.0), f.x),
        mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
    mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
        mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y),
    f.z
  );
}

// Fractal Brownian motion
float fbm(vec2 uv, float t) {
  vec3 p = vec3(uv * 4.0, t);
  float value = 0.0;
  float amplitude = 1.0;

  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p *= 1.25;
    amplitude *= 1.0;
  }

  return value * 0.5 + 0.5;
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy - uResolution * 0.5;
  float aspectRatio = uResolution.x / uResolution.y;

  // Grid calculations
  vec2 pixelId = floor(fragCoord / uPixelSize);
  float cellPixelSize = 8.0 * uPixelSize;
  vec2 cellCoord = floor(fragCoord / cellPixelSize) * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  // Animated noise pattern
  float feed = fbm(uv, uTime * 0.05);
  feed = feed * 0.5 - 0.65;

  // Apply Bayer dithering
  float bayer = Bayer8(pixelId) - 0.5;
  float dither = step(0.5, feed + bayer);

  // Mix colors based on dither pattern
  vec3 finalColor = mix(uBgColor, uColor, dither);
  fragColor = vec4(finalColor, 1.0);
}
`

// Shape type enum matching shader constants
export type ShapeType = 'square' | 'circle' | 'triangle' | 'diamond'
const SHAPE_MAP: Record<ShapeType, number> = {
  square: 0,
  circle: 1,
  triangle: 2,
  diamond: 3,
}

interface BayerDitherBackgroundProps {
  /** RGB color values (0-1 range). Default: purple accent */
  color?: [number, number, number]
  /** Background RGB color values (0-1 range). Default: dark grey */
  bgColor?: [number, number, number]
  /** Size of dither pixels in screen pixels. Default: 4 */
  pixelSize?: number
  /** Shape of dither dots. Default: 'square' */
  shape?: ShapeType
  /** Enable click ripple interaction. Default: true */
  interactive?: boolean
  /** CSS class for the container */
  className?: string
}

export function BayerDitherBackground({
  color = [0.55, 0.35, 0.85], // Purple accent color
  bgColor = [0.12, 0.12, 0.14], // Dark background matching foreground-2
  pixelSize = 4,
  shape = 'square',
  interactive = true,
  className = '',
}: BayerDitherBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const uniformsRef = useRef<{
    uTime: { value: number }
    uResolution: { value: THREE.Vector2 }
    uColor: { value: THREE.Vector3 }
    uBgColor: { value: THREE.Vector3 }
    uPixelSize: { value: number }
    uShapeType: { value: number }
  } | null>(null)
  const animationIdRef = useRef<number>(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Create WebGL2 renderer
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) {
      console.warn('[BayerDither] WebGL2 not supported')
      return
    }

    const renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: false,
      alpha: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(canvas)
    rendererRef.current = renderer

    // Initialize uniforms (simplified - removed click ripple for now)
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Vector3(...color) },
      uBgColor: { value: new THREE.Vector3(...bgColor) },
      uPixelSize: { value: pixelSize },
      uShapeType: { value: SHAPE_MAP[shape] },
    }
    uniformsRef.current = uniforms

    // Create scene with fullscreen quad
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    // Use GLSL3 for modern shader syntax (out vec4 fragColor instead of gl_FragColor)
    // Three.js will prepend the #version 300 es directive automatically
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: false,
      glslVersion: THREE.GLSL3,
    })

    // Fullscreen triangle (more efficient than quad)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
    )
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    // Compile and check for shader errors AFTER adding mesh to scene
    renderer.compile(scene, camera)

    // Check for shader compilation errors in WebGL context
    const programs = renderer.info.programs
    if (programs && programs.length > 0) {
      const programInfo = programs[0] as { diagnostics?: { vertexShader?: { log?: string }, fragmentShader?: { log?: string } } }
      if (programInfo.diagnostics?.vertexShader?.log) {
        console.error('[BayerDither] Vertex shader error:', programInfo.diagnostics.vertexShader.log)
      }
      if (programInfo.diagnostics?.fragmentShader?.log) {
        console.error('[BayerDither] Fragment shader error:', programInfo.diagnostics.fragmentShader.log)
      }
    }

    // Handle resize
    const handleResize = () => {
      const rect = container.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      renderer.setSize(width, height)
      uniforms.uResolution.value.set(width * renderer.getPixelRatio(), height * renderer.getPixelRatio())
    }
    handleResize()
    window.addEventListener('resize', handleResize)

    // Animation loop
    const startTime = performance.now()
    const animate = () => {
      uniforms.uTime.value = (performance.now() - startTime) / 1000
      renderer.render(scene, camera)
      animationIdRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationIdRef.current)
      renderer.dispose()
      material.dispose()
      geometry.dispose()
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
    }
  }, [])

  // Update uniforms when props change
  useEffect(() => {
    if (uniformsRef.current) {
      uniformsRef.current.uColor.value.set(...color)
    }
  }, [color])

  useEffect(() => {
    if (uniformsRef.current) {
      uniformsRef.current.uBgColor.value.set(...bgColor)
    }
  }, [bgColor])

  useEffect(() => {
    if (uniformsRef.current) {
      uniformsRef.current.uPixelSize.value = pixelSize
    }
  }, [pixelSize])

  useEffect(() => {
    if (uniformsRef.current) {
      uniformsRef.current.uShapeType.value = SHAPE_MAP[shape]
    }
  }, [shape])

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 -z-10 ${className}`}
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    />
  )
}
