import { useCallback, useEffect, useRef, useState } from 'react'
import { Layers, Play, Pause, Download, Loader2, Plus, Upload } from 'lucide-react'
import type { AudioJobStatus } from '@archstudio/shared/protocol'

interface RemixTrack {
  id: string
  name: string
  path: string
  gain: number
  pan: number
  color: string
}

const TRACK_COLORS = ['#a855f7', '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6']

export function RemixTimelinePanel() {
  const [tracks, setTracks] = useState<RemixTrack[]>([])
  const [mixing, setMixing] = useState(false)
  const [mixedPath, setMixedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const [playingAll, setPlayingAll] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  const addTrack = useCallback(async () => {
    try {
      const paths = await window.electronAPI.openFileDialog()
      if (paths.length === 0) return
      const path = paths[0]
      const name = path.split(/[\\/]/).pop() ?? path
      const id = Math.random().toString(36).slice(2, 9)
      const color = TRACK_COLORS[tracks.length % TRACK_COLORS.length]
      setTracks((prev) => [...prev, { id, name, path, gain: 1.0, pan: 0, color }])
      setMixedPath(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tracks.length])

  const removeTrack = useCallback((trackId: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== trackId))
    const audio = audioElementsRef.current.get(trackId)
    if (audio) {
      audio.pause()
      audioElementsRef.current.delete(trackId)
    }
    setMixedPath(null)
  }, [])

  const updateGain = useCallback((trackId: string, gain: number) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, gain } : t))
    setMixedPath(null)
  }, [])

  const updatePan = useCallback((trackId: string, pan: number) => {
    setTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, pan } : t))
    setMixedPath(null)
  }, [])

  const mix = useCallback(async () => {
    if (tracks.length < 2) {
      setError('Add at least 2 tracks to mix')
      return
    }
    setError(null)
    setMixing(true)
    setMixedPath(null)
    try {
      const result = await window.electronAPI.audioProcess({
        operation: 'mix',
        mixInputs: tracks.map((t) => ({ path: t.path, gain: t.gain, pan: t.pan })),
      })
      setJobId(result.jobId)
      setPolling(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setMixing(false)
    }
  }, [tracks])

  useEffect(() => {
    if (!polling || !jobId) return
    const poll = async () => {
      try {
        const status: AudioJobStatus = await window.electronAPI.audioJobStatus({ jobId })
        if (status.state === 'completed') {
          setPolling(false)
          setMixing(false)
          setMixedPath(status.output ?? null)
        } else if (status.state === 'failed') {
          setPolling(false)
          setMixing(false)
          setError(status.error ?? 'Mix failed')
        }
      } catch (e) {
        setPolling(false)
        setMixing(false)
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    void poll()
    pollRef.current = setInterval(poll, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [polling, jobId])

  const togglePlayAll = useCallback(() => {
    if (playingAll) {
      audioElementsRef.current.forEach((audio) => audio.pause())
      setPlayingAll(false)
    } else {
      audioElementsRef.current.forEach((audio) => {
        audio.currentTime = 0
        void audio.play()
      })
      setPlayingAll(true)
    }
  }, [playingAll])

  return (
    <div className="remix-timeline">
      <div className="remix-timeline__header">
        <div className="remix-timeline__title">
          <Layers size={20} />
          <div>
            <h3>Remix Timeline</h3>
            <p>Mix stems, beats, and audio into a single track</p>
          </div>
        </div>
        <div className="remix-timeline__transport">
          <button
            type="button"
            className="remix-timeline__play-all"
            onClick={togglePlayAll}
            disabled={tracks.length === 0}
          >
            {playingAll ? <Pause size={16} /> : <Play size={16} />}
            {playingAll ? 'Pause all' : 'Play all'}
          </button>
        </div>
      </div>

      <div className="remix-timeline__tracks">
        {tracks.length === 0 ? (
          <div className="remix-timeline__empty">
            <Upload size={32} />
            <p>No tracks added yet</p>
            <small>Add stems, beats, or any audio file to start remixing</small>
          </div>
        ) : (
          tracks.map((track) => (
            <RemixTrackRow
              key={track.id}
              track={track}
              audioRef={(el) => {
                if (el) audioElementsRef.current.set(track.id, el)
                else audioElementsRef.current.delete(track.id)
              }}
              onRemove={removeTrack}
              onGainChange={updateGain}
              onPanChange={updatePan}
            />
          ))
        )}
      </div>

      <div className="remix-timeline__actions">
        <button type="button" className="remix-timeline__add" onClick={addTrack}>
          <Plus size={14} /> Add track
        </button>
        <button
          type="button"
          className="remix-timeline__mix"
          disabled={mixing || tracks.length < 2}
          onClick={() => void mix()}
        >
          {mixing ? <Loader2 size={14} className="media-panel__spinner" /> : <Download size={14} />}
          {mixing ? 'Mixing...' : 'Mix & Export'}
        </button>
        {mixedPath && (
          <button
            type="button"
            className="remix-timeline__download"
            onClick={() => window.electronAPI.openFile(mixedPath)}
          >
            <Download size={14} /> Download mix
          </button>
        )}
      </div>

      {error && <div className="remix-timeline__error">{error}</div>}
    </div>
  )
}

interface RemixTrackRowProps {
  track: RemixTrack
  audioRef: (el: HTMLAudioElement | null) => void
  onRemove: (id: string) => void
  onGainChange: (id: string, gain: number) => void
  onPanChange: (id: string, pan: number) => void
}

function RemixTrackRow({ track, audioRef, onRemove, onGainChange, onPanChange }: RemixTrackRowProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const localAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.readFileDataUrl(track.path)
      .then((dataUrl) => { if (!cancelled) setSrc(dataUrl) })
      .catch(() => { if (!cancelled) setSrc(null) })
    return () => { cancelled = true }
  }, [track.path])

  const toggle = useCallback(() => {
    if (!localAudioRef.current) return
    if (playing) {
      localAudioRef.current.pause()
    } else {
      void localAudioRef.current.play()
    }
    setPlaying(!playing)
  }, [playing])

  return (
    <div className="remix-track">
      <div className="remix-track__label" style={{ borderLeftColor: track.color }}>
        <button type="button" className="remix-track__play" onClick={toggle} disabled={!src}>
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <span className="remix-track__name" title={track.name}>{track.name}</span>
        <button type="button" className="remix-track__remove" onClick={() => onRemove(track.id)}>×</button>
      </div>
      <div className="remix-track__controls">
        <div className="remix-track__control">
          <label>Vol</label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={track.gain}
            onChange={(e) => onGainChange(track.id, Number(e.target.value))}
          />
          <span>{Math.round(track.gain * 100)}%</span>
        </div>
        <div className="remix-track__control">
          <label>Pan</label>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={track.pan}
            onChange={(e) => onPanChange(track.id, Number(e.target.value))}
          />
          <span>{track.pan === 0 ? 'C' : track.pan < 0 ? 'L' : 'R'}</span>
        </div>
      </div>
      <audio
        ref={(el) => {
          localAudioRef.current = el
          audioRef(el)
        }}
        src={src ?? undefined}
        onEnded={() => setPlaying(false)}
      />
    </div>
  )
}