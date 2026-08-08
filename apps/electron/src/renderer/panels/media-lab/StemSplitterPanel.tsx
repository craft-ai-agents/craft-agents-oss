import { useCallback, useEffect, useRef, useState } from 'react'
import { Scissors, Loader2, Upload, Download, Play, Pause } from 'lucide-react'
import type { AudioJobStatus } from '@archstudio/shared/protocol'

interface StemResult {
  name: string
  path: string
}

export function StemSplitterPanel() {
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [inputName, setInputName] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<AudioJobStatus | null>(null)
  const [polling, setPolling] = useState(false)
  const [stems, setStems] = useState<StemResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pickFile = useCallback(async () => {
    try {
      const paths = await window.electronAPI.openFileDialog()
      if (paths.length > 0) {
        const path = paths[0]
        setInputPath(path)
        setInputName(path.split(/[\\/]/).pop() ?? path)
        setStems(null)
        setJobId(null)
        setJobStatus(null)
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const split = useCallback(async () => {
    if (!inputPath) return
    setError(null)
    setStems(null)
    setJobId(null)
    setJobStatus(null)
    try {
      const result = await window.electronAPI.audioStemSplit({ inputPath })
      setJobId(result.jobId)
      setPolling(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [inputPath])

  useEffect(() => {
    if (!polling || !jobId) return
    const poll = async () => {
      try {
        const status = await window.electronAPI.audioJobStatus({ jobId })
        setJobStatus(status)
        if (status.state === 'completed') {
          setPolling(false)
          if (status.outputs) {
            setStems(Object.entries(status.outputs).map(([name, path]) => ({ name, path })))
          }
        } else if (status.state === 'failed') {
          setPolling(false)
          setError(status.error ?? 'Stem splitting failed')
        }
      } catch (e) {
        setPolling(false)
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    void poll()
    pollRef.current = setInterval(poll, 1500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [polling, jobId])

  return (
    <div className="stem-splitter">
      <div className="stem-splitter__header">
        <Scissors size={20} />
        <div>
          <h3>Stem Splitter</h3>
          <p>Separate any track into vocals, drums, bass, and instruments</p>
        </div>
      </div>

      <div className="stem-splitter__drop-zone" onClick={pickFile}>
        {inputPath ? (
          <div className="stem-splitter__file-info">
            <Upload size={24} />
            <div>
              <strong>{inputName}</strong>
              <small>Click to change file</small>
            </div>
          </div>
        ) : (
          <div className="stem-splitter__placeholder">
            <Upload size={28} />
            <p>Click to select an audio file</p>
            <small>WAV, MP3, FLAC, OGG, M4A</small>
          </div>
        )}
      </div>

      {error && <div className="stem-splitter__error">{error}</div>}

      {jobStatus && jobStatus.state === 'running' && (
        <div className="stem-splitter__progress">
          <div className="stem-splitter__progress-bar">
            <div style={{ width: `${Math.round((jobStatus.progress ?? 0) * 100)}%` }} />
          </div>
          <small>{jobStatus.stage ?? 'Processing'}... {Math.round((jobStatus.progress ?? 0) * 100)}%</small>
        </div>
      )}

      <button
        type="button"
        className="stem-splitter__split-btn"
        disabled={!inputPath || polling}
        onClick={() => void split()}
      >
        {polling ? <Loader2 size={16} className="media-panel__spinner" /> : <Scissors size={16} />}
        {polling ? 'Splitting...' : 'Split stems'}
      </button>

      {stems && stems.length > 0 && (
        <div className="stem-splitter__results">
          <h4>Stems</h4>
          {stems.map((stem) => (
            <StemPlayer key={stem.name} name={stem.name} path={stem.path} />
          ))}
        </div>
      )}
    </div>
  )
}

function StemPlayer({ name, path }: { name: string; path: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.readFileDataUrl(path)
      .then((dataUrl) => { if (!cancelled) setSrc(dataUrl) })
      .catch(() => { if (!cancelled) setSrc(null) })
    return () => { cancelled = true }
  }, [path])

  const toggle = useCallback(() => {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
    } else {
      void audioRef.current.play()
    }
    setPlaying(!playing)
  }, [playing])

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  return (
    <div className="stem-player">
      <div className="stem-player__info">
        <span className={`stem-player__icon stem-player__icon--${name}`}>{capitalize(name)}</span>
      </div>
      <audio
        ref={audioRef}
        src={src ?? undefined}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" className="stem-player__play" onClick={toggle} disabled={!src}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button type="button" className="stem-player__download" onClick={() => window.electronAPI.openFile(path)}>
        <Download size={14} />
      </button>
    </div>
  )
}