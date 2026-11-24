/**
 * What the double-tap does when its helper process refuses to start the tap for lack of
 * Accessibility. A running process gets its Accessibility answer from a cache, which a grant
 * doesn't refresh (a real Accessibility call does): after a grant made while Craft Agents runs,
 * the main process, which asks live, is allowed, and the helper, where the tap lives, still says
 * no. A new helper asks macOS again.
 */

export interface TapRefusal {
  /** The main process's live answer: Craft Agents has Accessibility. */
  mainTrusted: boolean
  /** The helper was already replaced for this grant. */
  restarted: boolean
  /** The pie or panel is open: its selection read and pointer warp run in the helper. */
  busy: boolean
}

export interface TapRefusalStep {
  /** `restart`: replace the helper, then start the tap again; `wait`: try again at the next check. */
  action: 'restart' | 'wait'
  /** `restarted` from now on: cleared while there's no access, so the next grant gets its own restart. */
  restarted: boolean
}

export function afterTapRefused({ mainTrusted, restarted, busy }: TapRefusal): TapRefusalStep {
  if (!mainTrusted) return { action: 'wait', restarted: false }
  // Once per grant: a helper that still refuses after its restart isn't restarted at every check
  if (restarted || busy) return { action: 'wait', restarted }
  return { action: 'restart', restarted: true }
}
