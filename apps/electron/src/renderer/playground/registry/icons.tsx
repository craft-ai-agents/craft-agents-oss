import type { ComponentEntry } from './types'
import { G4OSLogo } from '@/components/icons/G4OSLogo'
import { G4OSSymbol } from '@/components/icons/G4OSSymbol'
import { PanelLeftRounded } from '@/components/icons/PanelLeftRounded'
import { SquarePenRounded } from '@/components/icons/SquarePenRounded'

export const iconComponents: ComponentEntry[] = [
  {
    id: 'craft-agents-logo',
    name: 'G4OSLogo',
    category: 'Icons',
    description: 'Full G4 OS branding logo with text',
    component: G4OSLogo,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes for sizing and styling',
        control: { type: 'string' },
        defaultValue: 'h-8',
      },
    ],
    variants: [
      { name: 'Small', props: { className: 'h-6' } },
      { name: 'Medium', props: { className: 'h-8' } },
      { name: 'Large', props: { className: 'h-12' } },
    ],
  },
  {
    id: 'craft-agents-symbol',
    name: 'G4OSSymbol',
    category: 'Icons',
    description: 'G4 OS "E" pixel art symbol icon (brand color: #9570BE)',
    component: G4OSSymbol,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes for sizing',
        control: { type: 'string' },
        defaultValue: 'h-6 w-6',
      },
    ],
    variants: [
      { name: 'Small', props: { className: 'h-4 w-4' } },
      { name: 'Medium', props: { className: 'h-6 w-6' } },
      { name: 'Large', props: { className: 'h-10 w-10' } },
    ],
  },
  {
    id: 'panel-left-rounded',
    name: 'PanelLeftRounded',
    category: 'Icons',
    description: 'Sidebar toggle icon with rounded corners',
    component: PanelLeftRounded,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes',
        control: { type: 'string' },
        defaultValue: 'h-5 w-5',
      },
    ],
    variants: [
      { name: 'Default', props: { className: 'h-5 w-5' } },
      { name: 'Large', props: { className: 'h-8 w-8' } },
      { name: 'Muted', props: { className: 'h-5 w-5 text-muted-foreground' } },
    ],
  },
  {
    id: 'square-pen-rounded',
    name: 'SquarePenRounded',
    category: 'Icons',
    description: 'New chat/compose icon with rounded corners',
    component: SquarePenRounded,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes',
        control: { type: 'string' },
        defaultValue: 'h-5 w-5',
      },
    ],
    variants: [
      { name: 'Default', props: { className: 'h-5 w-5' } },
      { name: 'Large', props: { className: 'h-8 w-8' } },
      { name: 'Primary', props: { className: 'h-5 w-5 text-foreground' } },
    ],
  },
]
