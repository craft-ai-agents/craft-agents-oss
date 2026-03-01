/**
 * Browser CDP Helpers
 *
 * Uses Electron's webContents.debugger API (Chrome DevTools Protocol) for:
 * - Accessibility tree snapshots with ref-based element identification
 * - Element interaction (click, fill, select) via CDP commands
 *
 * This is the same approach used by Playwright/Stagehand — deterministic,
 * no fragile CSS selectors needed.
 */

import type { WebContents } from 'electron'
import { mainLog } from './logger'

export interface AccessibilityNode {
  ref: string           // "@e1", "@e2", etc.
  role: string          // "button", "link", "textbox", etc.
  name: string          // Accessible name
  value?: string        // Current value (for inputs)
  description?: string  // Additional description
  focused?: boolean
  checked?: boolean
  disabled?: boolean
}

export interface AccessibilitySnapshot {
  url: string
  title: string
  nodes: AccessibilityNode[]
}

export interface ElementBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementGeometry {
  ref: string
  role?: string
  name?: string
  box: ElementBox
  clickPoint: { x: number; y: number }
}

export interface ViewportMetrics {
  width: number
  height: number
  dpr: number
  scrollX: number
  scrollY: number
}

// Roles that are typically interactive or contain meaningful content
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox',
  'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'treeitem', 'row', 'cell', 'columnheader',
  'rowheader', 'gridcell',
])

const CONTENT_ROLES = new Set([
  'heading', 'img', 'table', 'list', 'listitem',
  'paragraph', 'blockquote', 'article', 'main',
  'navigation', 'complementary', 'contentinfo', 'banner',
  'form', 'region', 'alert', 'dialog', 'alertdialog',
  'status', 'progressbar', 'meter', 'timer',
])

export class BrowserCDP {
  private webContents: WebContents
  private attached = false
  private detachListenerRegistered = false
  // Map from "@eN" refs to backend node IDs (refreshed on each snapshot)
  private refMap: Map<string, number> = new Map()
  // Map from "@eN" refs to semantic details captured during snapshot
  private refDetails: Map<string, { role: string; name: string }> = new Map()

  constructor(webContents: WebContents) {
    this.webContents = webContents
  }

  private async ensureAttached(): Promise<void> {
    if (this.attached) return
    try {
      this.webContents.debugger.attach('1.3')
      this.attached = true
    } catch (err) {
      // May already be attached
      if (String(err).includes('Already attached')) {
        this.attached = true
      } else {
        throw err
      }
    }

    if (!this.detachListenerRegistered) {
      this.detachListenerRegistered = true
      this.webContents.debugger.on('detach', () => {
        this.attached = false
      })
    }
  }

  detach(): void {
    if (this.attached) {
      try {
        this.webContents.debugger.detach()
      } catch { /* ignore */ }
      this.attached = false
    }
  }

  private async send(method: string, params?: Record<string, unknown>): Promise<any> {
    await this.ensureAttached()
    return this.webContents.debugger.sendCommand(method, params)
  }

  // ---------------------------------------------------------------------------
  // Accessibility Snapshot
  // ---------------------------------------------------------------------------

  async getAccessibilitySnapshot(): Promise<AccessibilitySnapshot> {
    const tree = await this.send('Accessibility.getFullAXTree')
    const nodes = tree.nodes as any[]

    this.refMap.clear()
    this.refDetails.clear()
    const result: AccessibilityNode[] = []
    let refCounter = 0

    for (const node of nodes) {
      const role = node.role?.value || ''
      const name = node.name?.value || ''
      const value = node.value?.value

      // Filter: only include interactive elements, content elements with names,
      // or elements with both role and name
      const isInteractive = INTERACTIVE_ROLES.has(role)
      const isContent = CONTENT_ROLES.has(role) && name
      const hasValue = value !== undefined && value !== ''

      if (!isInteractive && !isContent && !hasValue) continue

      // Skip generic roles without meaningful names
      if ((role === 'generic' || role === 'none' || !role) && !name) continue

      refCounter++
      const ref = `@e${refCounter}`

      // Store mapping from ref to backend node ID
      if (node.backendDOMNodeId) {
        this.refMap.set(ref, node.backendDOMNodeId)
        this.refDetails.set(ref, { role, name })
      }

      const accessNode: AccessibilityNode = {
        ref,
        role,
        name,
      }

      if (hasValue) accessNode.value = String(value)
      if (node.description?.value) accessNode.description = node.description.value

      // Boolean properties
      const props = node.properties as any[] | undefined
      if (props) {
        for (const prop of props) {
          if (prop.name === 'focused' && prop.value?.value === true) accessNode.focused = true
          if (prop.name === 'checked' && prop.value?.value !== 'false') accessNode.checked = prop.value?.value === true || prop.value?.value === 'true'
          if (prop.name === 'disabled' && prop.value?.value === true) accessNode.disabled = true
        }
      }

      result.push(accessNode)

      // Cap at 500 nodes to prevent token explosion
      if (refCounter >= 500) break
    }

    return {
      url: this.webContents.getURL(),
      title: this.webContents.getTitle(),
      nodes: result,
    }
  }

  // ---------------------------------------------------------------------------
  // Screenshot Annotation Helpers
  // ---------------------------------------------------------------------------

  async getElementGeometry(ref: string): Promise<ElementGeometry> {
    const backendNodeId = this.refMap.get(ref)
    if (!backendNodeId) {
      throw new Error(`Element ${ref} not found. Run browser_snapshot first to get current element refs.`)
    }

    const { model } = await this.send('DOM.getBoxModel', { backendNodeId })
    const content = model.content as number[]

    const xs = [content[0], content[2], content[4], content[6]]
    const ys = [content[1], content[3], content[5], content[7]]

    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    const clickX = (content[0] + content[2] + content[4] + content[6]) / 4
    const clickY = (content[1] + content[3] + content[5] + content[7]) / 4

    const details = this.refDetails.get(ref)

    return {
      ref,
      role: details?.role,
      name: details?.name,
      box: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
      clickPoint: { x: clickX, y: clickY },
    }
  }

  async getElementGeometryBySelector(selector: string): Promise<ElementGeometry> {
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => {
        const candidates = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        if (candidates.length === 0) return null;

        const isVisible = (el) => {
          if (!(el instanceof Element)) return false;
          const style = window.getComputedStyle(el);
          if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
          if (Number(style.opacity || '1') === 0) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          return true;
        };

        const el = candidates.find(isVisible) || candidates[0];
        const rect = el.getBoundingClientRect();
        const tag = (el.tagName && typeof el.tagName === 'string') ? el.tagName.toLowerCase() : 'element';
        const text = (typeof el.textContent === 'string') ? el.textContent.slice(0, 120) : '';
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          tag,
          text,
        };
      })()`,
      returnByValue: true,
    })

    const value = result?.result?.value
    if (!value) {
      throw new Error(`No element found for selector "${selector}"`)
    }

    if (Number(value.width) <= 0 || Number(value.height) <= 0) {
      throw new Error(`Element found for selector "${selector}" has zero size`)
    }

    return {
      ref: `selector:${selector}`,
      role: String(value.tag || 'element'),
      name: String(value.text || '').trim(),
      box: {
        x: Number(value.x),
        y: Number(value.y),
        width: Number(value.width),
        height: Number(value.height),
      },
      clickPoint: {
        x: Number(value.cx),
        y: Number(value.cy),
      },
    }
  }

  async getViewportMetrics(): Promise<ViewportMetrics> {
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0
      }))()`,
      returnByValue: true,
    })

    const v = result?.result?.value ?? {}
    return {
      width: Number(v.width || 0),
      height: Number(v.height || 0),
      dpr: Number(v.dpr || 1),
      scrollX: Number(v.scrollX || 0),
      scrollY: Number(v.scrollY || 0),
    }
  }

  async renderTemporaryOverlay(params: {
    geometries: ElementGeometry[]
    includeMetadata?: boolean
    metadataText?: string
    includeClickPoints?: boolean
  }): Promise<void> {
    const payload = {
      geometries: params.geometries,
      includeMetadata: !!params.includeMetadata,
      metadataText: params.metadataText || '',
      includeClickPoints: params.includeClickPoints !== false,
    }

    await this.send('Runtime.evaluate', {
      expression: `(() => {
        const existing = document.getElementById('__craft_agent_screenshot_overlay__');
        if (existing) existing.remove();

        const root = document.createElement('div');
        root.id = '__craft_agent_screenshot_overlay__';
        root.style.position = 'fixed';
        root.style.inset = '0';
        root.style.pointerEvents = 'none';
        root.style.zIndex = '2147483647';

        const payload = ${JSON.stringify(payload)};

        for (const g of payload.geometries || []) {
          const box = document.createElement('div');
          box.style.position = 'fixed';
          box.style.left = g.box.x + 'px';
          box.style.top = g.box.y + 'px';
          box.style.width = g.box.width + 'px';
          box.style.height = g.box.height + 'px';
          box.style.border = '2px solid rgba(59, 130, 246, 0.95)';
          box.style.borderRadius = '6px';
          box.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.8) inset';
          root.appendChild(box);

          const label = document.createElement('div');
          label.style.position = 'fixed';
          label.style.left = g.box.x + 'px';
          label.style.top = Math.max(4, g.box.y - 24) + 'px';
          label.style.padding = '2px 6px';
          label.style.borderRadius = '6px';
          label.style.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
          label.style.background = 'rgba(15, 23, 42, 0.92)';
          label.style.color = 'white';
          label.style.maxWidth = '70vw';
          label.style.whiteSpace = 'nowrap';
          label.style.overflow = 'hidden';
          label.style.textOverflow = 'ellipsis';
          const labelText = [g.ref, g.role, g.name].filter(Boolean).join(' • ');
          label.textContent = labelText;
          root.appendChild(label);

          if (payload.includeClickPoints && g.clickPoint) {
            const point = document.createElement('div');
            point.style.position = 'fixed';
            point.style.left = (g.clickPoint.x - 4) + 'px';
            point.style.top = (g.clickPoint.y - 4) + 'px';
            point.style.width = '8px';
            point.style.height = '8px';
            point.style.borderRadius = '999px';
            point.style.background = 'rgba(239, 68, 68, 0.98)';
            point.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.8)';
            root.appendChild(point);
          }
        }

        if (payload.includeMetadata && payload.metadataText) {
          const meta = document.createElement('div');
          meta.style.position = 'fixed';
          meta.style.right = '8px';
          meta.style.bottom = '8px';
          meta.style.padding = '4px 8px';
          meta.style.borderRadius = '6px';
          meta.style.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
          meta.style.background = 'rgba(15, 23, 42, 0.92)';
          meta.style.color = 'white';
          meta.textContent = payload.metadataText;
          root.appendChild(meta);
        }

        document.documentElement.appendChild(root);
      })()`,
    })
  }

  async clearTemporaryOverlay(): Promise<void> {
    await this.send('Runtime.evaluate', {
      expression: `(() => {
        const existing = document.getElementById('__craft_agent_screenshot_overlay__');
        if (existing) existing.remove();
      })()`,
    })
  }

  // ---------------------------------------------------------------------------
  // Element Interaction
  // ---------------------------------------------------------------------------

  async clickAtCoordinates(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x, y,
      button: 'left',
      clickCount: 1,
    })
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y,
      button: 'left',
      clickCount: 1,
    })
  }

  async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    // Interpolate intermediate mouseMoved events for realistic drag
    const dx = x2 - x1
    const dy = y2 - y1
    const distance = Math.sqrt(dx * dx + dy * dy)
    const steps = Math.max(5, Math.min(20, Math.round(distance / 20)))
    let lastX = x1
    let lastY = y1
    let primaryError: unknown = null

    // Press at start position
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: x1, y: y1,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })

    try {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const x = Math.round(x1 + dx * t)
        const y = Math.round(y1 + dy * t)
        await this.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x, y,
          button: 'left',
          buttons: 1,
        })
        lastX = x
        lastY = y

        // Small delay between moves for realistic drag behavior
        if (i < steps) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
    } catch (error) {
      primaryError = error
    }

    // Always attempt release so page state is not left in pressed/dragging mode.
    try {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: lastX,
        y: lastY,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      })
    } catch (releaseError) {
      if (!primaryError) throw releaseError
      mainLog.warn(
        `[browser-cdp] drag release failed after primary error: ${
          releaseError instanceof Error ? releaseError.message : String(releaseError)
        }`,
      )
    }

    if (primaryError) throw primaryError
  }

  async typeText(text: string): Promise<void> {
    for (const char of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', text: char })
    }
  }

  async setClipboard(text: string): Promise<void> {
    await this.send('Runtime.evaluate', {
      expression: `navigator.clipboard.writeText(${JSON.stringify(text)})`,
      awaitPromise: true,
      userGesture: true,
    })
  }

  async getClipboard(): Promise<string> {
    const result = await this.send('Runtime.evaluate', {
      expression: 'navigator.clipboard.readText()',
      awaitPromise: true,
      userGesture: true,
    })
    return (result as any).result?.value ?? ''
  }

  async clickElement(ref: string): Promise<ElementGeometry> {
    const backendNodeId = this.refMap.get(ref)
    if (!backendNodeId) {
      throw new Error(`Element ${ref} not found. Run browser_snapshot first to get current element refs.`)
    }

    try {
      // Resolve node to get objectId
      const { object } = await this.send('DOM.resolveNode', { backendNodeId })

      // Scroll element into view first
      await this.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function() { this.scrollIntoViewIfNeeded(); }',
      })

      // Get element box model after scroll for up-to-date click coordinates
      const geometry = await this.getElementGeometry(ref)
      const x = geometry.clickPoint.x
      const y = geometry.clickPoint.y

      // Dispatch mouse events (mousedown + mouseup + click)
      await this.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x, y,
        button: 'left',
        clickCount: 1,
      })
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x, y,
        button: 'left',
        clickCount: 1,
      })

      return geometry
    } catch (err) {
      mainLog.error(`[browser-cdp] Click failed for ${ref}:`, err)
      throw new Error(`Failed to click ${ref}: ${err}`)
    }
  }

  async fillElement(ref: string, value: string): Promise<ElementGeometry> {
    const backendNodeId = this.refMap.get(ref)
    if (!backendNodeId) {
      throw new Error(`Element ${ref} not found. Run browser_snapshot first to get current element refs.`)
    }

    try {
      // Focus the element first
      await this.send('DOM.focus', { backendNodeId })

      // Clear existing content
      const { object } = await this.send('DOM.resolveNode', { backendNodeId })
      await this.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function() {
          this.value = '';
          this.dispatchEvent(new Event('input', { bubbles: true }));
        }`,
      })

      // Type the new value character by character for realistic input
      for (const char of value) {
        await this.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
        })
        await this.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char,
        })
      }

      // Dispatch change event
      await this.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function() {
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }`,
      })

      return await this.getElementGeometry(ref)
    } catch (err) {
      mainLog.error(`[browser-cdp] Fill failed for ${ref}:`, err)
      throw new Error(`Failed to fill ${ref}: ${err}`)
    }
  }

  async selectOption(ref: string, value: string): Promise<ElementGeometry> {
    const backendNodeId = this.refMap.get(ref)
    if (!backendNodeId) {
      throw new Error(`Element ${ref} not found. Run browser_snapshot first to get current element refs.`)
    }

    try {
      const { object } = await this.send('DOM.resolveNode', { backendNodeId })
      await this.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function(val) {
          this.value = val;
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }`,
        arguments: [{ value }],
      })

      return await this.getElementGeometry(ref)
    } catch (err) {
      mainLog.error(`[browser-cdp] Select failed for ${ref}:`, err)
      throw new Error(`Failed to select option in ${ref}: ${err}`)
    }
  }

  async setFileInputFiles(ref: string, filePaths: string[]): Promise<ElementGeometry> {
    const backendNodeId = this.refMap.get(ref)
    if (!backendNodeId) {
      throw new Error(`Element ${ref} not found. Run browser_snapshot first to get current element refs.`)
    }

    try {
      await this.send('DOM.setFileInputFiles', {
        files: filePaths,
        backendNodeId,
      })

      return await this.getElementGeometry(ref)
    } catch (err) {
      mainLog.error(`[browser-cdp] setFileInputFiles failed for ${ref}:`, err)
      throw new Error(`Failed to set files on ${ref}: ${err}`)
    }
  }
}
