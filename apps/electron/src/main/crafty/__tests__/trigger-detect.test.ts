import { describe, expect, it } from 'bun:test'
import {
  GAP_MAX_MS,
  reduceTrigger,
  TAP_MAX_MS,
  TRIGGER_IDLE,
  type ModifierChange,
  type TriggerKey,
  type TriggerOutput,
  type TriggerState,
} from '../trigger-detect'

const NON_COALESCED = 0x100
const LEFT_CMD = { keyCode: 55, down: 0x100000 | 0x08 | NON_COALESCED }
const RIGHT_CMD = { keyCode: 54, down: 0x100000 | 0x10 | NON_COALESCED }
const LEFT_SHIFT = { keyCode: 56, down: 0x020000 | 0x02 | NON_COALESCED }
const LEFT_OPTION = { keyCode: 58, down: 0x080000 | 0x20 | NON_COALESCED }
const LEFT_CONTROL = { keyCode: 59, down: 0x040000 | 0x01 | NON_COALESCED }

/** A scripted session: modifier changes at given times, and when the last key press / click was. */
class Keyboard {
  state: TriggerState = TRIGGER_IDLE
  outputs: Array<TriggerOutput & { at: number }> = []
  private lastKeyAt = -1e9
  private lastClickAt = -1e9

  constructor(private readonly key: TriggerKey = 'command') {}

  change(at: number, keyCode: number, flags: number): this {
    const change: ModifierChange = { keyCode, flags, at, sinceKeyMs: at - this.lastKeyAt, sinceClickMs: at - this.lastClickAt }
    const { state, output } = reduceTrigger(this.state, change, this.key)
    this.state = state
    if (output) this.outputs.push({ ...output, at })
    return this
  }

  typeKey(at: number): this {
    this.lastKeyAt = at
    return this
  }

  click(at: number): this {
    this.lastClickAt = at
    return this
  }

  /** Press and release the left ⌘ (or another key with its flags), with extra flags held. */
  tap(down: number, up: number, key = LEFT_CMD, held = NON_COALESCED): this {
    return this.change(down, key.keyCode, key.down | held).change(up, key.keyCode, held)
  }
}

describe('reduceTrigger', () => {
  it('fires press on the second press and release when it ends (tap, tap)', () => {
    const kb = new Keyboard().tap(0, 80).tap(200, 260)
    expect(kb.outputs).toEqual([
      { type: 'press', at: 200 },
      { type: 'release', heldMs: 60, interrupted: false, at: 260 },
    ])
    expect(kb.state).toEqual(TRIGGER_IDLE)
  })

  it('reports a long second press as a hold (tap, then hold and release)', () => {
    const kb = new Keyboard().tap(0, 90).tap(250, 1400)
    expect(kb.outputs.map(o => o.type)).toEqual(['press', 'release'])
    expect(kb.outputs[1]).toMatchObject({ heldMs: 1150, interrupted: false })
  })

  it('never fires for ⌘C ⌘V: a key press between the taps', () => {
    const kb = new Keyboard()
    kb.change(0, LEFT_CMD.keyCode, LEFT_CMD.down).typeKey(40).change(90, LEFT_CMD.keyCode, NON_COALESCED)
    kb.change(200, LEFT_CMD.keyCode, LEFT_CMD.down).typeKey(230).change(280, LEFT_CMD.keyCode, NON_COALESCED)
    expect(kb.outputs).toEqual([])
  })

  it('never fires when a key was pressed after the first tap', () => {
    const kb = new Keyboard().tap(0, 80).typeKey(120).tap(200, 260)
    expect(kb.outputs).toEqual([])
  })

  it('never fires when a click came between the taps', () => {
    const kb = new Keyboard().tap(0, 80).click(150).tap(200, 260)
    expect(kb.outputs).toEqual([])
  })

  it('a key typed before the first tap does not matter', () => {
    const kb = new Keyboard().typeKey(-500).tap(0, 80).tap(200, 260)
    expect(kb.outputs.map(o => o.type)).toEqual(['press', 'release'])
  })

  it('needs the first press to be a tap', () => {
    const kb = new Keyboard().tap(0, TAP_MAX_MS + 1).tap(TAP_MAX_MS + 100, TAP_MAX_MS + 150)
    expect(kb.outputs).toEqual([])
  })

  it('needs the second press within the gap; a late press starts the next pair', () => {
    const kb = new Keyboard().tap(0, 80)
    kb.tap(80 + GAP_MAX_MS + 1, 80 + GAP_MAX_MS + 60)
    expect(kb.outputs).toEqual([])
    // That late press was a tap of its own: a quick third press completes a pair with it
    kb.tap(80 + GAP_MAX_MS + 200, 80 + GAP_MAX_MS + 260)
    expect(kb.outputs.map(o => o.type)).toEqual(['press', 'release'])
  })

  it('ignores a double-tap with another modifier held (⇧⌘ ⇧⌘)', () => {
    const shift = 0x020000 | 0x02 | NON_COALESCED
    const kb = new Keyboard().change(-50, LEFT_SHIFT.keyCode, LEFT_SHIFT.down)
    kb.tap(0, 80, LEFT_CMD, shift).tap(200, 260, LEFT_CMD, shift)
    expect(kb.outputs).toEqual([])
  })

  it('resets when another modifier is pressed between the taps', () => {
    const kb = new Keyboard().tap(0, 80)
    kb.change(120, LEFT_SHIFT.keyCode, LEFT_SHIFT.down).change(150, LEFT_SHIFT.keyCode, NON_COALESCED)
    kb.tap(200, 260)
    expect(kb.outputs).toEqual([])
  })

  it('ignores the right ⌘, and the left one while the right is held', () => {
    expect(new Keyboard().tap(0, 80, RIGHT_CMD).tap(200, 260, RIGHT_CMD).outputs).toEqual([])
    const rightHeld = 0x100000 | 0x10 | NON_COALESCED
    const kb = new Keyboard().change(-100, RIGHT_CMD.keyCode, RIGHT_CMD.down)
    kb.change(0, LEFT_CMD.keyCode, LEFT_CMD.down | rightHeld).change(80, LEFT_CMD.keyCode, rightHeld)
    kb.change(200, LEFT_CMD.keyCode, LEFT_CMD.down | rightHeld).change(260, LEFT_CMD.keyCode, rightHeld)
    expect(kb.outputs).toEqual([])
  })

  it('works with a keyboard that sets no device bits', () => {
    const plain = { keyCode: 55, down: 0x100000 }
    const kb = new Keyboard().tap(0, 80, plain, 0).tap(200, 260, plain, 0)
    expect(kb.outputs.map(o => o.type)).toEqual(['press', 'release'])
  })

  it('marks a release interrupted when a key or click came during the hold (tap ⌘, then ⌘C)', () => {
    const kb = new Keyboard().tap(0, 80)
    kb.change(200, LEFT_CMD.keyCode, LEFT_CMD.down).typeKey(260).change(400, LEFT_CMD.keyCode, NON_COALESCED)
    expect(kb.outputs[1]).toMatchObject({ type: 'release', interrupted: true })
    const clicked = new Keyboard().tap(0, 80)
    clicked.change(200, LEFT_CMD.keyCode, LEFT_CMD.down).click(300).change(700, LEFT_CMD.keyCode, NON_COALESCED)
    expect(clicked.outputs[1]).toMatchObject({ type: 'release', interrupted: true })
  })

  it('keeps holding when another modifier is pressed during the hold', () => {
    const kb = new Keyboard().tap(0, 80)
    kb.change(200, LEFT_CMD.keyCode, LEFT_CMD.down)
    kb.change(300, LEFT_SHIFT.keyCode, LEFT_CMD.down | 0x020000 | 0x02)
    kb.change(350, LEFT_SHIFT.keyCode, LEFT_CMD.down)
    kb.change(500, LEFT_CMD.keyCode, NON_COALESCED)
    expect(kb.outputs.map(o => o.type)).toEqual(['press', 'release'])
  })

  it('uses the left ⌥ or ⌃ when set, and ignores ⌘ then', () => {
    expect(new Keyboard('option').tap(0, 80, LEFT_OPTION).tap(200, 260, LEFT_OPTION).outputs.map(o => o.type)).toEqual(['press', 'release'])
    expect(new Keyboard('control').tap(0, 80, LEFT_CONTROL).tap(200, 260, LEFT_CONTROL).outputs.map(o => o.type)).toEqual(['press', 'release'])
    expect(new Keyboard('option').tap(0, 80).tap(200, 260).outputs).toEqual([])
  })

  it('fires again for the next double-tap', () => {
    const kb = new Keyboard().tap(0, 80).tap(200, 260).tap(2000, 2080).tap(2200, 2900)
    expect(kb.outputs.map(o => o.type)).toEqual(['press', 'release', 'press', 'release'])
  })
})
