import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { GitPanel } from '../GitPanel'

describe('GitPanel empty states', () => {
  it('renders a no working directory empty state when no workspace path is provided', () => {
    const markup = renderToStaticMarkup(<GitPanel />)

    expect(markup).toContain('No working directory set')
  })
})
