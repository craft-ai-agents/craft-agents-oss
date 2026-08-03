/**
 * Unit tests for the no-teleporting-state ESLint rule.
 *
 * Drives the rule through ESLint's `Linter` directly (same harness as
 * env-sanitizer-audit.test.ts) so the tests run cleanly under bun:test.
 *
 * The rule should:
 *   - Flag `{isOpen && <JSX>}` / `{expanded && <JSX>}` conditional renders
 *     whose mount is not animated (no AnimatePresence ancestor, no
 *     animate-in class, no motion.* element, no allowed component).
 *   - Allow the same shapes when one of those exemptions holds.
 *   - Ignore data gates (`showTransportConnectionBanner && ...`,
 *     `openCountCapped && ...`) that are not state toggles.
 */

import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import noTeleportingState from '../no-teleporting-state.cjs'

function lint(code: string, options?: unknown[]) {
  const linter = new Linter()
  return linter.verify(code, {
    plugins: {
      'archstudio-motion': {
        rules: {
          'no-teleporting-state': noTeleportingState as any,
        },
      },
    },
    rules: {
      'archstudio-motion/no-teleporting-state': options
        ? (['error', ...options] as any)
        : 'error',
    },
    languageOptions: {
      parser: tsParser as any,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  })
}

const FAIL = 'teleportingState'

describe('no-teleporting-state', () => {
  // ── Flags ────────────────────────────────────────────────────────────
  it('flags {isOpen && <JSX>} with no animation', () => {
    const errs = lint('const x = <div>{isOpen && <p>hi</p>}</div>')
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL)
    expect(errs[0]!.message).toContain('isOpen')
  })

  it('flags {expanded && <JSX>} with no animation', () => {
    expect(
      lint('const x = <div>{expanded && <p>hi</p>}</div>')[0]?.messageId,
    ).toBe(FAIL)
  })

  it('flags {open && <JSX>} with no animation', () => {
    expect(
      lint('const x = <div>{open && <p>hi</p>}</div>')[0]?.messageId,
    ).toBe(FAIL)
  })

  it('flags {!isCollapsed && <JSX>} (negated toggle)', () => {
    const errs = lint('const x = <div>{!isCollapsed && <p>hi</p>}</div>')
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL)
    expect(errs[0]!.message).toContain('!isCollapsed')
  })

  it('flags member-property toggles like state.isOpen / link.expanded', () => {
    expect(
      lint('const x = <div>{state.isOpen && <p>hi</p>}</div>')[0]?.messageId,
    ).toBe(FAIL)
    expect(
      lint('const x = <div>{link.expanded && <p>hi</p>}</div>')[0]?.messageId,
    ).toBe(FAIL)
  })

  it('flags toggle && data && <JSX> chains', () => {
    // SearchPanel "Collapse" button shape.
    const errs = lint(
      'const x = <div>{isOpen && result.matches.length > 3 && <button>Collapse</button>}</div>',
    )
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL)
    expect(errs[0]!.message).toContain('isOpen')
  })

  it('names the toggle even when it sits on the right of a nested &&', () => {
    // `data && isOpen && <JSX>` — the toggle is on the right; the message
    // must name `isOpen`, not degrade to the generic placeholder.
    const errs = lint(
      'const x = <div>{result.matches.length > 3 && isOpen && <button>Collapse</button>}</div>',
    )
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL)
    expect(errs[0]!.message).toContain('isOpen')
  })

  it('does not flag active/visible/shown micro-indicators by default', () => {
    // isActive/isVisible/isShown are deliberately opt-in: they gate 4px
    // check icons and active-state dots, which should not animate.
    expect(
      lint('const x = <div>{isActive && <Check />}</div>'),
    ).toEqual([])
    expect(
      lint('const x = <div>{isVisible && <span>hi</span>}</div>'),
    ).toEqual([])
    expect(
      lint('const x = <div>{isShown && <span>hi</span>}</div>'),
    ).toEqual([])
  })

  it('flags active/visible/shown when opted in via additionalToggleNames', () => {
    expect(
      lint('const x = <div>{isActive && <Check />}</div>', [
        { additionalToggleNames: ['isActive'] },
      ])[0]?.messageId,
    ).toBe(FAIL)
  })

  it('flags a single flag across multiple toggled elements', () => {
    const errs = lint(
      'const x = <div>{isOpen && <p>a</p>}{isOpen && <p>b</p>}</div>',
    )
    expect(errs).toHaveLength(2)
  })

  // ── Exemptions ───────────────────────────────────────────────────────
  it('allows when wrapped in <AnimatePresence>', () => {
    expect(
      lint(
        'const x = <AnimatePresence>{isOpen && <motion.div>hi</motion.div>}</AnimatePresence>',
      ),
    ).toEqual([])
  })

  it('allows {isOpen && <JSX>} with an animate-in className literal', () => {
    expect(
      lint(
        'const x = <div>{isOpen && <div className="animate-in fade-in-0 zoom-in-95 duration-100">hi</div>}</div>',
      ),
    ).toEqual([])
  })

  it('allows animate-in inside a cn(...) call', () => {
    expect(
      lint(
        "const x = <div>{isOpen && <div className={cn('animate-in fade-in-0', 'duration-100')}>hi</div>}</div>",
      ),
    ).toEqual([])
  })

  it('allows animate-in via a conditional inside cn(...)', () => {
    expect(
      lint(
        "const x = <div>{isOpen && <div className={cn('base', isOpen && 'animate-in')}>hi</div>}</div>",
      ),
    ).toEqual([])
  })

  it('allows motion.* elements', () => {
    expect(
      lint(
        'const x = <div>{isOpen && <motion.div initial={{opacity: 0}} animate={{opacity: 1}}>hi</motion.div>}</div>',
      ),
    ).toEqual([])
  })

  it('allows a createPortal whose JSX argument carries animate-in', () => {
    expect(
      lint(
        "const x = <div>{isOpen && position && ReactDOM.createPortal(<div className='animate-in fade-in-0 zoom-in-95 duration-100'>menu</div>, document.body)}</div>",
      ),
    ).toEqual([])
  })

  it('flags a createPortal whose JSX argument has no animate-in', () => {
    const errs = lint(
      'const x = <div>{isOpen && position && ReactDOM.createPortal(<div>menu</div>, document.body)}</div>',
    )
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL)
  })

  it('allows animate-in through a transparent wrapper (Context.Provider) in a portal', () => {
    // SimpleDropdown shape: the animate-in div sits inside a context Provider.
    expect(
      lint(
        "const x = <div>{isOpen && position && ReactDOM.createPortal(<SimpleDropdownContext.Provider value={ctx}><div className='animate-in fade-in-0 zoom-in-95 duration-100'>menu</div></SimpleDropdownContext.Provider>, document.body)}</div>",
      ),
    ).toEqual([])
  })

  it('still flags animate-in on a wrapper but not the styled surface itself', () => {
    // A styled (className'd) surface without animate-in stays flagged even
    // when a sibling child is animated.
    const errs = lint(
      "const x = <div>{isOpen && <div className='plain-surface'><div className='animate-in fade-in-0'>inner</div></div>}</div>",
    )
    expect(errs).toHaveLength(1)
    expect(errs[0]!.messageId).toBe(FAIL)
  })

  it('allows AnimatedCollapsibleContent by default', () => {
    expect(
      lint(
        'const x = <div>{isOpen && <AnimatedCollapsibleContent isOpen={isOpen}>hi</AnimatedCollapsibleContent>}</div>',
      ),
    ).toEqual([])
  })

  // ── Non-toggles (data gates) ─────────────────────────────────────────
  it('ignores show* data gates', () => {
    expect(
      lint('const x = <div>{showTransportConnectionBanner && connectionState && <p>hi</p>}</div>'),
    ).toEqual([])
    expect(
      lint('const x = <div>{openCountCapped && <p>hi</p>}</div>'),
    ).toEqual([])
    expect(
      lint('const x = <div>{showRetry && <p>hi</p>}</div>'),
    ).toEqual([])
  })

  it('ignores non-boolean truthiness gates (objects/ids)', () => {
    expect(
      lint('const x = <div>{activeSessionId && <p>hi</p>}</div>'),
    ).toEqual([])
    expect(
      lint('const x = <div>{activeFileObj && <p>hi</p>}</div>'),
    ).toEqual([])
  })

  it('ignores comparisons / non-&& expressions', () => {
    expect(
      lint('const x = <div>{openSlug === slug ? <p>hi</p> : null}</div>'),
    ).toEqual([])
    expect(
      lint('const x = <div>{matches.length > 3 && <p>hi</p>}</div>'),
    ).toEqual([])
  })

  it('ignores non-JSX render targets (strings, numbers, ids)', () => {
    expect(
      lint('const x = <div>{isOpen && someLabel}</div>'),
    ).toEqual([])
    expect(
      lint('const x = <div>{isOpen && "literal"}</div>'),
    ).toEqual([])
  })

  // ── Rule options ─────────────────────────────────────────────────────
  it('honors additionalToggleNames', () => {
    expect(
      lint('const x = <div>{showServerDetails && <p>hi</p>}</div>'),
    ).toEqual([])
    expect(
      lint('const x = <div>{showServerDetails && <p>hi</p>}</div>', [
        { additionalToggleNames: ['showServerDetails'] },
      ])[0]?.messageId,
    ).toBe(FAIL)
  })

  it('honors ignoreToggleNames', () => {
    expect(
      lint('const x = <div>{isOpen && <p>hi</p>}</div>', [
        { ignoreToggleNames: ['isOpen'] },
      ]),
    ).toEqual([])
  })

  it('honors allowedComponents', () => {
    expect(
      lint('const x = <div>{isOpen && <MyAnimatedPanel>hi</MyAnimatedPanel>}</div>', [
        { allowedComponents: ['MyAnimatedPanel'] },
      ]),
    ).toEqual([])
  })
})
