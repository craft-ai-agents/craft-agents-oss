/**
 * Playground: what a session shows while it's Crafty's target ("Send Crafty Here"): the glow over
 * the composer, which moves as the session becomes the target and then stays still, and the Crafty
 * chip in its toolbar, whose click stops it. The card stands in for the composer (the app takes
 * both from Crafty's target store, which the playground lacks).
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import type { ComponentEntry } from './types'
import { CraftyGlow } from '@/components/crafty/CraftyGlow'
import { CraftyChip } from '@/components/crafty/CraftyComposerChip'
import { craftyOpeningComponents } from './crafty-opening'
import { craftyRadialComponents } from './crafty-radial'

interface CraftyTargetDemoProps {
  /** Start as Crafty's target, the glow moving */
  autoplay?: boolean
}

function CraftyTargetDemo({ autoplay = true }: CraftyTargetDemoProps) {
  const [attached, setAttached] = React.useState(autoplay)
  const [playKey, setPlayKey] = React.useState(autoplay ? 1 : 0)
  return (
    <div className="flex w-[600px] max-w-full flex-col gap-3">
      <div className="input-container relative h-[114px] overflow-hidden rounded-xl bg-raised shadow-elev-1">
        <CraftyGlow playKey={playKey} active={attached} />
        <div className="absolute inset-x-0 top-0 px-4 pt-3 text-copy text-tertiary">Ask a follow-up…</div>
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 px-2 pb-2">
          {attached && <CraftyChip onStop={() => setAttached(false)} />}
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        disabled={attached}
        onClick={() => {
          setAttached(true)
          setPlayKey(key => key + 1)
        }}
      >
        Send Crafty here
      </Button>
    </div>
  )
}

export const craftyComponents: ComponentEntry[] = [
  ...craftyOpeningComponents,
  ...craftyRadialComponents,
  {
    id: 'crafty-target',
    name: 'Crafty · Send Crafty Here',
    category: 'Crafty',
    description:
      'A session while it\'s Crafty\'s target: Ultrathink\'s pulsing border moves over the composer as it becomes the target (not under reduced motion), then stays still, in the theme accent\'s colors, until the Crafty chip in the toolbar is clicked.',
    component: CraftyTargetDemo,
    layout: 'centered',
    previewOverflow: 'visible',
    props: [
      { name: 'autoplay', description: 'Start as Crafty\'s target, the glow moving', control: { type: 'boolean' }, defaultValue: true },
    ],
  },
]
