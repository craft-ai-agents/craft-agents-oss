import React from 'react'
import { ArrowRight, Brain, Zap, Shield } from 'lucide-react'
import './HomeHero.css'

export type HomeHeroProps = {
  onOpenCommand?: () => void
  onExploreMemory?: () => void
}

export function HomeHero({ onOpenCommand, onExploreMemory }: HomeHeroProps) {
  return (
    <div className="home-hero">
      <div className="home-hero__bg" aria-hidden="true" />
      <div className="home-hero__content">
        <div className="home-hero__badge">AI Super Studio</div>
        <h1 className="home-hero__title">
          <span className="home-hero__title-arch">ARCH</span>
          <span className="home-hero__title-studio">studio</span>
        </h1>
        <p className="home-hero__tagline">
          <span className="home-hero__tagline-line" />
          AI AGENT
          <span className="home-hero__tagline-line" />
        </p>
        <p className="home-hero__subtitle">
          A project-based operating environment for agents, memory, media, and automation.
        </p>
        <div className="home-hero__actions">
          <button type="button" className="home-hero__primary" onClick={onOpenCommand}>
            Open Command
            <ArrowRight size={16} />
          </button>
          <button type="button" className="home-hero__secondary" onClick={onExploreMemory}>
            Explore Memory
            <Brain size={16} />
          </button>
        </div>

        <div className="home-hero__features">
          <div className="home-hero__feature">
            <Zap size={18} />
            <div>
              <strong>Fast workflows</strong>
              <span>Run agents and tools without friction.</span>
            </div>
          </div>
          <div className="home-hero__feature">
            <Brain size={18} />
            <div>
              <strong>Persistent memory</strong>
              <span>A second brain that links notes, decisions, and context.</span>
            </div>
          </div>
          <div className="home-hero__feature">
            <Shield size={18} />
            <div>
              <strong>Controlled access</strong>
              <span>Permissions and scoping built in from the start.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
