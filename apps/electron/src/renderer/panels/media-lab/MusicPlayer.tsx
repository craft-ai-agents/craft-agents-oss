import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Shuffle, Loader2, Music, Download } from 'lucide-react'
import { WaveformDisplay } from './WaveformDisplay'

interface MusicTrack {
  name: string
  path: string
  size: number
  mtime: number
}

export function MusicPlayer() {
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [loading, setLoading] = useState(true)
  const [src, setSrc] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const currentTrack = currentIdx >= 0 ? tracks[currentIdx] : null

  useEffect(() => {
    void loadTracks()
  }, [])

  const loadTracks = useCallback(async () => {
    setLoading(true)
    try {
      const page = await window.electronAPI.comfyArtifacts({ kind: 'audio', limit: 500 })
      setTracks(page.items.map((item) => ({
        name: item.name,
        path: item.path,
        size: item.size ?? 0,
        mtime: item.mtime ?? 0,
      })))
    } catch {
      setTracks([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (currentIdx < 0 || !currentTrack) return
    let cancelled = false
    setSrc(null)
    setProgress(0)
    setCurrentTime(0)
    window.electronAPI.readFileDataUrl(currentTrack.path)
      .then((dataUrl) => { if (!cancelled) setSrc(dataUrl) })
      .catch(() => { if (!cancelled) setSrc(null) })
    return () => { cancelled = true }
  }, [currentIdx, currentTrack])

  const play = useCallback(() => {
    if (!audioRef.current || !src) return
    void audioRef.current.play()
    setPlaying(true)
  }, [src])

  const pause = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    setPlaying(false)
  }, [])

  const toggle = useCallback(() => {
    if (playing) pause()
    else play()
  }, [playing, play, pause])

  const next = useCallback(() => {
    if (tracks.length === 0) return
    if (shuffle) {
      let idx = Math.floor(Math.random() * tracks.length)
      if (idx === currentIdx) idx = (idx + 1) % tracks.length
      setCurrentIdx(idx)
    } else {
      setCurrentIdx((prev) => prev + 1 >= tracks.length ? (repeat ? 0 : -1) : prev + 1)
    }
  }, [tracks.length, shuffle, currentIdx, repeat])

  const prev = useCallback(() => {
    if (tracks.length === 0) return
    setCurrentIdx((prevIdx) => prevIdx <= 0 ? tracks.length - 1 : prevIdx - 1)
  }, [tracks.length])

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !audioRef.current.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    audioRef.current.currentTime = x * audioRef.current.duration
    setProgress(x)
  }, [])

  const changeVolume = useCallback((v: number) => {
    setVolume(v)
    setMuted(v === 0)
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((m) => !m)
  }, [])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume
    }
  }, [volume, muted])

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const selectTrack = useCallback((idx: number) => {
    setCurrentIdx(idx)
    setPlaying(false)
  }, [])

  return (
    <div className="music-player">
      <div className="music-player__main">
        <div className="music-player__art">
          {currentTrack ? (
            <div className="music-player__art-active">
              <Music size={48} />
              <span>{currentTrack.name}</span>
            </div>
          ) : (
            <div className="music-player__art-empty">
              <Music size={48} />
              <span>Select a track</span>
            </div>
          )}
        </div>

        <div className="music-player__info">
          <div className="music-player__track-name">{currentTrack?.name ?? 'No track selected'}</div>
          <div className="music-player__track-meta">
            {tracks.length} tracks available
          </div>

          {currentTrack && (
            <div className="music-player__waveform">
              <WaveformDisplay audioPath={currentTrack.path} height={60} color="#a855f7" progress={progress} />
            </div>
          )}

          <div className="music-player__seek-bar" onClick={seek}>
            <div className="music-player__seek-progress" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="music-player__time">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="music-player__controls">
          <button type="button" onClick={() => setShuffle((s) => !s)} className={`music-player__btn${shuffle ? ' is-active' : ''}`}>
            <Shuffle size={16} />
          </button>
          <button type="button" onClick={prev} className="music-player__btn" disabled={tracks.length === 0}>
            <SkipBack size={18} />
          </button>
          <button type="button" onClick={toggle} className="music-player__btn music-player__btn--play" disabled={!src}>
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button type="button" onClick={next} className="music-player__btn" disabled={tracks.length === 0}>
            <SkipForward size={18} />
          </button>
          <button type="button" onClick={() => setRepeat((r) => !r)} className={`music-player__btn${repeat ? ' is-active' : ''}`}>
            <Repeat size={16} />
          </button>
        </div>

        <div className="music-player__volume">
          <button type="button" onClick={toggleMute} className="music-player__btn">
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="music-player__playlist">
        <div className="music-player__playlist-header">
          <h4>Library</h4>
          {loading && <Loader2 size={14} className="music-panel__spinner" />}
          <button type="button" onClick={() => void loadTracks()} className="music-player__refresh">Refresh</button>
        </div>
        {tracks.length === 0 && !loading ? (
          <div className="music-player__empty">
            <Music size={32} />
            <p>No audio files found</p>
            <small>Generate audio in Stems, Beats, or Remix tabs</small>
          </div>
        ) : (
          <div className="music-player__track-list">
            {tracks.map((track, idx) => (
              <div
                key={track.path}
                className={`music-player__track-item${idx === currentIdx ? ' is-current' : ''}`}
                onClick={() => selectTrack(idx)}
              >
                <span className="music-player__track-num">{idx === currentIdx && playing ? '▶' : idx + 1}</span>
                <span className="music-player__track-title">{track.name}</span>
                <span className="music-player__track-size">{(track.size / 1024 / 1024).toFixed(1)}MB</span>
                {idx === currentIdx && (
                  <button
                    type="button"
                    className="music-player__track-download"
                    onClick={(e) => { e.stopPropagation(); window.electronAPI.openFile(track.path) }}
                  >
                    <Download size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <audio
        ref={audioRef}
        src={src ?? undefined}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget
          if (audio.duration) {
            setCurrentTime(audio.currentTime)
            setProgress(audio.currentTime / audio.duration)
          }
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={next}
      />
    </div>
  )
}