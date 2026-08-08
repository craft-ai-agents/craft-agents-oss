import { useEffect, useRef, useState } from 'react'

interface WaveformDisplayProps {
  audioPath: string
  height?: number
  color?: string
  progress?: number
}

export function WaveformDisplay({ audioPath, height = 48, color = '#a855f7', progress }: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.readFileDataUrl(audioPath)
      .then(async (dataUrl) => {
        if (cancelled) return
        try {
          const arrayBuffer = await fetch(dataUrl).then((r) => r.arrayBuffer())
          const audioCtx = new AudioContext()
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          if (cancelled) return
          const channel = audioBuffer.getChannelData(0)
          const samples = 200
          const blockSize = Math.floor(channel.length / samples)
          const peakData = new Float32Array(samples)
          for (let i = 0; i < samples; i++) {
            let max = 0
            for (let j = 0; j < blockSize; j++) {
              const abs = Math.abs(channel[i * blockSize + j] ?? 0)
              if (abs > max) max = abs
            }
            peakData[i] = max
          }
          audioCtx.close()
          if (!cancelled) setPeaks(peakData)
        } catch {
          if (!cancelled) setPeaks(null)
        }
      })
      .catch(() => { if (!cancelled) setPeaks(null) })
    return () => { cancelled = true }
  }, [audioPath])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.offsetWidth * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)
    const w = canvas.offsetWidth
    const h = height
    ctx.clearRect(0, 0, w, h)
    const barWidth = w / peaks.length
    const barGap = Math.max(1, barWidth * 0.2)
    const drawWidth = barWidth - barGap
    const progressX = progress !== undefined ? progress * w : -1
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth
      const barHeight = Math.max(2, peaks[i] * h * 0.9)
      const y = (h - barHeight) / 2
      if (progressX >= 0 && x < progressX) {
        ctx.fillStyle = color
      } else {
        ctx.fillStyle = `${color}40`
      }
      ctx.fillRect(x, y, drawWidth, barHeight)
    }
  }, [peaks, height, color, progress])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height, display: 'block' }}
    />
  )
}