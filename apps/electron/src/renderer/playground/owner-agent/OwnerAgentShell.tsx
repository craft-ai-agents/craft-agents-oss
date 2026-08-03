import {
  Activity,
  ArrowUp,
  Brain,
  ChevronDown,
  Clapperboard,
  Command,
  FolderKanban,
  Paperclip,
  Plug,
  SearchCode,
  Settings,
  ShieldCheck,
  Square,
} from 'lucide-react'
import './owner-agent-shell.css'

export type OwnerAgentShellState =
  | 'loading'
  | 'empty'
  | 'active'
  | 'streaming'
  | 'tool-running'
  | 'permission'
  | 'error'
  | 'disconnected'

type OwnerAgentShellProps = {
  state?: OwnerAgentShellState
  compact?: boolean
}

const destinations = [
  { label: 'Command', icon: Command, active: true },
  { label: 'Runs', icon: Activity, active: false },
  { label: 'Projects', icon: FolderKanban, active: false },
  { label: 'Memory', icon: Brain, active: false },
  { label: 'Media Lab', icon: Clapperboard, active: false },
  { label: 'Integrations', icon: Plug, active: false },
] as const

function OwnerMark() {
  return (
    <svg aria-hidden="true" className="oa-mark" viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="oa-green-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#C0FE3E" />
          <stop offset="100%" stopColor="#1E5C13" />
        </linearGradient>
        <linearGradient id="oa-purple-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#4C1D95" />
        </linearGradient>
      </defs>
      {/* Left half of Ring */}
      <path d="M 16 3 A 11 11 0 0 0 16 25" stroke="url(#oa-green-grad)" strokeWidth="2.2" strokeLinecap="round" />
      {/* Right half of Ring */}
      <path d="M 16 3 A 11 11 0 0 1 16 25" stroke="url(#oa-purple-grad)" strokeWidth="2.2" strokeLinecap="round" />
      {/* Left leg of 'A' */}
      <path d="M 16 7 L 10 20.5 L 13.5 20.5 L 16 15 Z" fill="url(#oa-green-grad)" />
      {/* Right leg of 'A' */}
      <path d="M 16 7 L 22 20.5 L 18.5 20.5 L 16 15 Z" fill="url(#oa-purple-grad)" />
      {/* Floating Center Rhombus */}
      <path d="M 16 17 L 17.5 19 L 16 20.5 L 14.5 19 Z" fill="url(#oa-purple-grad)" />
    </svg>
  )
}

function StatePanel({ state }: { state: Exclude<OwnerAgentShellState, 'streaming' | 'tool-running'> }) {
  const content = {
    loading: {
      eyebrow: 'Getting ready',
      title: 'Preparing your command workspace',
      detail: 'Restoring the owner scope, runtime health, and recent runs.',
      action: 'Cancel',
    },
    empty: {
      eyebrow: 'Owner command',
      title: 'What should we tackle?',
      detail: 'Start with a direct command. Runtime, scope, tools, and outputs stay visible while work runs.',
      action: 'Browse capabilities',
    },
    active: {
      eyebrow: 'Verified',
      title: 'Baseline repair complete',
      detail: '127 tests passed, i18n checks are clean, and the renderer build completed successfully.',
      action: 'Open run record',
    },
    permission: {
      eyebrow: 'Policy boundary',
      title: 'Approval needed',
      detail: 'This action would publish outside the authorised repository scope. Nothing has been sent.',
      action: 'Review action',
    },
    error: {
      eyebrow: 'Stopped safely',
      title: 'Run failed',
      detail: 'The renderer task exited before producing an artifact. Existing files were left unchanged.',
      action: 'Inspect failure',
    },
    disconnected: {
      eyebrow: 'Connection lost',
      title: 'Runtime disconnected',
      detail: 'The command remains queued locally. Reconnect the primary runtime to continue from this point.',
      action: 'Reconnect runtime',
    },
  }[state]

  return (
    <div className={`oa-state-panel oa-state-panel--${state}`}>
      <OwnerMark />
      <span className="oa-eyebrow">{content.eyebrow}</span>
      <h2>{content.title}</h2>
      <p>{content.detail}</p>
      {state === 'empty' && (
        <div className="oa-prompt-grid">
          <button type="button">Inspect this repository</button>
          <button type="button">Continue the active plan</button>
          <button type="button">Generate a media artifact</button>
        </div>
      )}
      <button className="oa-state-action" type="button">{content.action}</button>
    </div>
  )
}

function ActiveRun({ state }: { state: 'streaming' | 'tool-running' }) {
  const toolRunning = state === 'tool-running'
  return (
    <>
      <div className="oa-time-rule"><span>Today · 04:58</span></div>
      <article className="oa-message oa-message--owner">
        <div className="oa-message-meta"><span>You</span><time>04:58</time></div>
        <p>Build the first redesigned command shell in the playground. Keep the app running and verify every step.</p>
      </article>
      <article className="oa-message oa-message--agent">
        <div className="oa-agent-heading">
          <OwnerMark />
          <div>
            <strong>ARCHstudio</strong>
            <span>Working in authorised repository scope</span>
          </div>
          <time>04:58</time>
        </div>
        <strong className="oa-live-heading">{toolRunning ? 'Running validation' : 'Working through validation'}</strong>
        <p>{toolRunning
          ? 'The canonical test matrix is running in the isolated repository environment.'
          : 'I\u2019ve isolated the redesign from the production shell. Implementation and live visual verification follow.'}</p>
        <section aria-label="Current run" className="oa-run-card">
          <header>
            <span className="oa-run-icon"><SearchCode aria-hidden="true" size={17} /></span>
            <div>
              <span className="oa-run-state"><i />Running</span>
              <strong>{toolRunning ? 'Running validation' : 'Inspecting renderer architecture'}</strong>
            </div>
            <time>{toolRunning ? '01:12' : '00:31'}</time>
            <button aria-label="Stop current run" className="oa-stop-button" type="button">
              <Square aria-hidden="true" fill="currentColor" size={10} />
            </button>
          </header>
          <div className="oa-progress"><span /></div>
          <footer>
            <code>{toolRunning ? 'bun run validate:ci' : 'apps/electron/src/renderer/playground'}</code>
            <span>{toolRunning ? '108 shared tests passed' : '12 files inspected'}</span>
          </footer>
        </section>
      </article>
    </>
  )
}

/** Derive state-sensitive chrome values */
function useStateChromeInfo(state: OwnerAgentShellState) {
  const isRunning = state === 'streaming' || state === 'tool-running'
  const isDisconnected = state === 'disconnected'
  const isError = state === 'error'
  const isLoading = state === 'loading'

  const healthClass = isDisconnected || isError
    ? 'oa-health is-degraded'
    : isLoading
      ? 'oa-health is-loading'
      : 'oa-health'

  const footerText = isDisconnected
    ? 'Runtime offline'
    : isError
      ? 'Last run failed'
      : isLoading
        ? 'Connecting…'
        : 'All systems ready'

  const footerDetail = isDisconnected
    ? '0 connected'
    : isError
      ? 'Check run log'
      : isLoading
        ? 'Discovering services'
        : '4 local services'

  const sessionStatus = isRunning
    ? 'is-running'
    : state === 'active'
      ? 'is-complete'
      : isError
        ? 'is-failed'
        : isDisconnected
          ? 'is-disconnected'
          : state === 'permission'
            ? 'is-paused'
            : ''

  const sessionMeta = isRunning
    ? 'Running · renderer architecture'
    : state === 'active'
      ? 'Verified · 127 tests'
      : isError
        ? 'Failed · renderer task'
        : isDisconnected
          ? 'Disconnected · waiting'
          : state === 'permission'
            ? 'Awaiting approval'
            : isLoading
              ? 'Loading…'
              : 'Ready'

  return { isRunning, healthClass, footerText, footerDetail, sessionStatus, sessionMeta }
}

export function OwnerAgentShell({ state = 'streaming', compact = false }: OwnerAgentShellProps) {
  const {
    isRunning,
    healthClass,
    footerText,
    footerDetail,
    sessionStatus,
    sessionMeta,
  } = useStateChromeInfo(state)

  return (
    <section className={`oa-shell${compact ? ' oa-shell--compact' : ''}`} data-state={state}>
      <nav aria-label="Owner Agent navigation" className="oa-rail">
        <div className="oa-brand" title="ARCHstudio">
          <OwnerMark />
        </div>

        <div className="oa-destinations">
          {destinations.map(({ label, icon: Icon, active }) => (
            <button
              aria-current={active ? 'page' : undefined}
              className={`oa-destination${active ? ' is-active' : ''}`}
              key={label}
              type="button"
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <button className="oa-destination oa-settings" type="button">
          <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
      </nav>

      <aside className="oa-context">
        <header className="oa-context-header">
          <div>
            <span className="oa-eyebrow">Workspace</span>
            <strong>Owner command</strong>
          </div>
          <button aria-label="Create command" className="oa-icon-button" type="button">+</button>
        </header>

        <div className="oa-filter-row" role="tablist" aria-label="Session filter">
          <button aria-selected="true" className="oa-filter is-active" role="tab" type="button">Active</button>
          <button aria-selected="false" className="oa-filter" role="tab" type="button">Pinned</button>
          <button aria-selected="false" className="oa-filter" role="tab" type="button">All</button>
        </div>

        <div className="oa-session-list">
          <button aria-current="true" className="oa-session is-active" type="button">
            <span className={`oa-session-status ${sessionStatus}`} />
            <span>
              <strong>Owner-agent redesign</strong>
              <small>{sessionMeta}</small>
            </span>
            <time>now</time>
          </button>
          <button className="oa-session" type="button">
            <span className="oa-session-status is-complete" />
            <span>
              <strong>Baseline validation</strong>
              <small>Verified · 127 tests</small>
            </span>
            <time>12m</time>
          </button>
          <button className="oa-session" type="button">
            <span className="oa-session-status" />
            <span>
              <strong>ComfyUI workflow audit</strong>
              <small>Media Lab · 4 artifacts</small>
            </span>
            <time>2h</time>
          </button>
        </div>

        <footer className="oa-context-footer">
          <span><i className={healthClass} />{footerText}</span>
          <span>{footerDetail}</span>
        </footer>
      </aside>

      <main className="oa-stage">
        <header className="oa-stage-header">
          <div className="oa-title-block">
            <span className="oa-eyebrow">Command</span>
            <h1>Owner-agent redesign</h1>
          </div>

          <div className="oa-runtime-controls">
            <button className="oa-capsule oa-runtime" type="button">
              <span className="oa-provider-glyph">C</span>
              <span>
                <small>Primary runtime</small>
                <strong>GPT-5.6 Codex</strong>
              </span>
              <i className={healthClass} />
              <ChevronDown aria-hidden="true" size={14} />
            </button>
            <button className="oa-icon-button" title="Open inspector" type="button">···</button>
          </div>
        </header>

        <div className="oa-scope-bar">
          <div className="oa-scope-item">
            <ShieldCheck aria-hidden="true" size={15} />
            <span><strong>Owner Auto</strong> · repository scope</span>
          </div>
          <code>D:\craft-agents-oss</code>
          <span className="oa-capability-count">8 capabilities</span>
        </div>

        <div className="oa-transcript" aria-live="polite" aria-atomic="false">
          {state === 'streaming' || state === 'tool-running'
            ? <ActiveRun state={state} />
            : <StatePanel state={state} />}
        </div>

        <footer className="oa-composer-wrap">
          <div className="oa-composer">
            <textarea aria-label="Command message" placeholder="Give ARCHstudio a command…" rows={2} />
            <div className="oa-composer-actions">
              <div>
                <button className="oa-composer-button" type="button"><Paperclip aria-hidden="true" size={16} />Attach</button>
                <button className="oa-composer-button" type="button">Tools <span>8</span></button>
              </div>
              <div>
                <span className="oa-shortcut">{isRunning ? 'Shift ↵ queue' : 'Enter to send'}</span>
                {isRunning && (
                  <button aria-label="Stop current run" className="oa-send is-stop" type="button">
                    <Square aria-hidden="true" fill="currentColor" size={11} />
                  </button>
                )}
                <button aria-label={isRunning ? 'Queue follow-up' : 'Send command'} className="oa-send" type="button">
                  <ArrowUp aria-hidden="true" size={16} />
                </button>
              </div>
            </div>
          </div>
          <p>One primary runtime · actions and outputs remain visible in Runs</p>
        </footer>
      </main>
    </section>
  )
}
