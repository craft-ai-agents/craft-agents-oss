import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, Download, Loader2, Plus, Upload } from 'lucide-react'
import type { AudioJobStatus, BeatRenderRequest, BeatTrackStep } from '@archstudio/shared/protocol'

const STEPS = 16
const DEFAULT_TRACKS: Omit<BeatTrackStep, 'steps'>[] = [
  { name: 'Kick', sample: 'kick', volume: 1.0 },
  { name: 'Snare', sample: 'snare', volume: 0.8 },
  { name: 'Hi-Hat', sample: 'hihat', volume: 0.6 },
  { name: 'Clap', sample: 'clap', volume: 0.7 },
]

const DEFAULT_PATTERNS: Record<string, number[]> = {
  Kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  Snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  'Hi-Hat': [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  Clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
}

const SAMPLE_NAMES = ['kick', 'snare', 'hihat', 'clap', 'bass']
const SAMPLE_LABELS: Record<string, string> = {
  kick: 'Kick', snare: 'Snare', hihat: 'Hi-Hat', clap: 'Clap', bass: 'Bass',
}

export function BeatMakerPanel() {
  const [tracks, setTracks] = useState<BeatTrackStep[]>(
    DEFAULT_TRACKS.map((t) => ({ ...t, steps: [...DEFAULT_PATTERNS[t.name]] })),
  )
  const [bpm, setBpm] = useState(120)
  const [playing, setPlaying] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [rendering, setRendering] = useState(false)
  const [renderedPath, setRenderedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const nextStepRef = useRef(0)
  const nextTimeRef = useRef(0)
  const customSamplesRef = useRef<Map<string, AudioBuffer>>(new Map())

  const toggleStep = useCallback((trackIdx: number, stepIdx: number) => {
    setTracks((prev) => prev.map((track, i) => {
      if (i !== trackIdx) return track
      const newSteps = [...track.steps]
      newSteps[stepIdx] = newSteps[stepIdx] ? 0 : 1
      return { ...track, steps: newSteps }
    }))
  }, [])

  const addTrack = useCallback(() => {
    const sample = SAMPLE_NAMES[tracks.length % SAMPLE_NAMES.length]
    setTracks((prev) => [...prev, {
      name: `${SAMPLE_LABELS[sample]} ${prev.filter((t) => t.sample === sample).length + 1}`,
      sample,
      volume: 0.8,
      steps: new Array(STEPS).fill(0),
    }])
  }, [tracks.length])

  const removeTrack = useCallback((trackIdx: number) => {
    setTracks((prev) => prev.filter((_, i) => i !== trackIdx))
  }, [])

  const updateTrackVolume = useCallback((trackIdx: number, volume: number) => {
    setTracks((prev) => prev.map((track, i) => i === trackIdx ? { ...track, volume } : track))
  }, [])

  const changeTrackSample = useCallback((trackIdx: number, sample: string) => {
    setTracks((prev) => prev.map((track, i) =>
      i === trackIdx ? { ...track, sample, name: SAMPLE_LABELS[sample] ?? sample } : track,
    ))
  }, [])

  const loadCustomSample = useCallback(async () => {
    try {
      const paths = await window.electronAPI.openFileDialog()
      if (paths.length === 0) return
      const path = paths[0]
      const dataUrl = await window.electronAPI.readFileDataUrl(path)
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const arrayBuffer = await fetch(dataUrl).then((r) => r.arrayBuffer())
      const buffer = await audioCtxRef.current.decodeAudioData(arrayBuffer)
      const sampleName = `custom_${Date.now().toString(36)}`
      customSamplesRef.current.set(sampleName, buffer)
      SAMPLE_NAMES.push(sampleName)
      SAMPLE_LABELS[sampleName] = path.split(/[\\/]/).pop() ?? 'Custom'
      const name = SAMPLE_LABELS[sampleName]
      setTracks((prev) => [...prev, {
        name,
        sample: sampleName,
        volume: 0.8,
        steps: new Array(STEPS).fill(0),
      }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const synthHit = useCallback((ctx: AudioContext, sample: string, time: number, volume: number) => {
    // Custom uploaded sample
    if (sample.startsWith('custom_')) {
      const buffer = customSamplesRef.current.get(sample)
      if (buffer) {
        const src = ctx.createBufferSource()
        const gain = ctx.createGain()
        src.buffer = buffer
        src.connect(gain).connect(ctx.destination)
        gain.gain.setValueAtTime(volume, time)
        src.start(time)
      }
      return
    }
    if (sample === 'kick') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain).connect(ctx.destination)
      osc.frequency.setValueAtTime(150, time)
      osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.15)
      gain.gain.setValueAtTime(volume * 0.8, time)
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15)
      osc.start(time)
      osc.stop(time + 0.15)
    } else if (sample === 'snare') {
      const noise = ctx.createBufferSource()
      const buffer = ctx.createBuffer(1, 4410, 44100)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      noise.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.value = 1000
      const gain = ctx.createGain()
      noise.connect(filter).connect(gain).connect(ctx.destination)
      gain.gain.setValueAtTime(volume * 0.5, time)
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1)
      noise.start(time)
      noise.stop(time + 0.1)
    } else if (sample === 'hihat') {
      const noise = ctx.createBufferSource()
      const buffer = ctx.createBuffer(1, 2205, 44100)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      noise.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.value = 7000
      const gain = ctx.createGain()
      noise.connect(filter).connect(gain).connect(ctx.destination)
      gain.gain.setValueAtTime(volume * 0.3, time)
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05)
      noise.start(time)
      noise.stop(time + 0.05)
    } else if (sample === 'clap') {
      const noise = ctx.createBufferSource()
      const buffer = ctx.createBuffer(1, 4410, 44100)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      noise.buffer = buffer
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 1500
      const gain = ctx.createGain()
      noise.connect(filter).connect(gain).connect(ctx.destination)
      gain.gain.setValueAtTime(volume * 0.4, time)
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1)
      noise.start(time)
      noise.stop(time + 0.1)
    } else if (sample === 'bass') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(80, time)
      osc.connect(gain).connect(ctx.destination)
      gain.gain.setValueAtTime(volume * 0.6, time)
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2)
      osc.start(time)
      osc.stop(time + 0.2)
    }
  }, [])

  const startPlayback = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') void ctx.resume()

    setPlaying(true)
    nextStepRef.current = 0
    nextTimeRef.current = ctx.currentTime + 0.1

    const stepDuration = 60.0 / bpm / (STEPS / 4)

    schedulerRef.current = setInterval(() => {
      if (!audioCtxRef.current) return
      const ctx = audioCtxRef.current
      const now = ctx.currentTime
      const scheduleAheadTime = 0.1

      while (nextTimeRef.current < now + scheduleAheadTime) {
        const step = nextStepRef.current
        setCurrentStep(step)

        for (const track of tracks) {
          if (track.steps[step % STEPS]) {
            synthHit(ctx, track.sample, nextTimeRef.current, track.volume ?? 1.0)
          }
        }

        nextTimeRef.current += stepDuration
        nextStepRef.current = (nextStepRef.current + 1) % STEPS
      }
    }, 25)
  }, [bpm, tracks, synthHit])

  const stopPlayback = useCallback(() => {
    setPlaying(false)
    setCurrentStep(-1)
    if (schedulerRef.current) {
      clearInterval(schedulerRef.current)
      schedulerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (schedulerRef.current) clearInterval(schedulerRef.current)
      if (audioCtxRef.current) void audioCtxRef.current.close()
    }
  }, [])

  const renderBeat = useCallback(async () => {
    setError(null)
    setRendering(true)
    setRenderedPath(null)
    try {
      const request: BeatRenderRequest = {
        bpm,
        bars: 1,
        steps: STEPS,
        tracks,
      }
      const result = await window.electronAPI.audioBeatRender(request)
      setJobId(result.jobId)
      setPolling(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRendering(false)
    }
  }, [bpm, tracks])

  useEffect(() => {
    if (!polling || !jobId) return
    const poll = async () => {
      try {
        const status: AudioJobStatus = await window.electronAPI.audioJobStatus({ jobId })
        if (status.state === 'completed') {
          setPolling(false)
          setRendering(false)
          setRenderedPath(status.output ?? null)
        } else if (status.state === 'failed') {
          setPolling(false)
          setRendering(false)
          setError(status.error ?? 'Render failed')
        }
      } catch (e) {
        setPolling(false)
        setRendering(false)
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    void poll()
    pollRef.current = setInterval(poll, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [polling, jobId])

  return (
    <div className="beat-maker">
      <div className="beat-maker__header">
        <div className="beat-maker__title">
          <Play size={20} />
          <div>
            <h3>Beat Maker</h3>
            <p>Step sequencer with synthesized drums</p>
          </div>
        </div>
        <div className="beat-maker__transport">
          <button type="button" className="beat-maker__play-btn" onClick={playing ? stopPlayback : startPlayback}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
            {playing ? 'Stop' : 'Play'}
          </button>
          <button type="button" className="beat-maker__stop-btn" onClick={stopPlayback}>
            <Square size={14} />
          </button>
          <div className="beat-maker__bpm">
            <label>BPM</label>
            <input
              type="number"
              min={60}
              max={200}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="beat-maker__grid">
        {tracks.map((track, trackIdx) => (
          <div key={trackIdx} className="beat-maker__track">
            <div className="beat-maker__track-label">
              <select
                value={track.sample}
                onChange={(e) => changeTrackSample(trackIdx, e.target.value)}
                className="beat-maker__track-select"
              >
                {SAMPLE_NAMES.map((s) => (
                  <option key={s} value={s}>{SAMPLE_LABELS[s]}</option>
                ))}
              </select>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={track.volume ?? 1.0}
                onChange={(e) => updateTrackVolume(trackIdx, Number(e.target.value))}
                className="beat-maker__volume"
                title="Volume"
              />
              <button
                type="button"
                className="beat-maker__remove"
                onClick={() => removeTrack(trackIdx)}
                title="Remove track"
              >
                ×
              </button>
            </div>
            <div className="beat-maker__steps">
              {track.steps.map((active, stepIdx) => (
                <button
                  key={stepIdx}
                  type="button"
                  className={`beat-maker__step${active ? ' is-active' : ''}${currentStep === stepIdx ? ' is-current' : ''}${stepIdx % 4 === 0 ? ' is-downbeat' : ''}`}
                  onClick={() => toggleStep(trackIdx, stepIdx)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="beat-maker__actions">
        <button type="button" className="beat-maker__add-track" onClick={addTrack}>
          <Plus size={14} /> Add track
        </button>
        <button type="button" className="beat-maker__upload-sample" onClick={loadCustomSample}>
          <Upload size={14} /> Load sample
        </button>
        <button
          type="button"
          className="beat-maker__render"
          disabled={rendering}
          onClick={() => void renderBeat()}
        >
          {rendering ? <Loader2 size={14} className="media-panel__spinner" /> : <Download size={14} />}
          {rendering ? 'Rendering...' : 'Render to WAV'}
        </button>
        {renderedPath && (
          <button
            type="button"
            className="beat-maker__download-btn"
            onClick={() => window.electronAPI.openFile(renderedPath)}
          >
            <Download size={14} /> Download
          </button>
        )}
      </div>

      {error && <div className="beat-maker__error">{error}</div>}
    </div>
  )
}