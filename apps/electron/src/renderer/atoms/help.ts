import { atom } from 'jotai'
import type { DocFeature } from '@g4os/shared/docs/doc-links'

interface HelpDialogState {
  open: boolean
  feature: DocFeature
}

export const helpDialogAtom = atom<HelpDialogState>({
  open: false,
  feature: 'sources',
})
