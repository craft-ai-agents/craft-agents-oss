import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '../../../../../shared/types'
import type { AccountRecovery } from '../ErrorMessage'

// Bun does not resolve Vite's asset URL imports in the shared UI barrel.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
const { ErrorMessage } = await import('../ErrorMessage')

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: { common: { retry: 'Retry' }, chat: { modelPicker: { switchAccount: 'Switch account' } } } } },
  })
})

const error: Message = {
  id: 'limit', role: 'error', content: 'Rate Limit Exceeded', errorTitle: 'Rate Limit Exceeded',
  errorCode: 'rate_limited', errorCanRetry: true, timestamp: 1,
  errorActions: [{ key: 'r', label: 'Retry', action: 'retry' }],
}
const accountRecovery: AccountRecovery = {
  targets: [{ slug: 'alternative', name: 'Alternative', providerType: 'anthropic', authType: 'oauth', createdAt: 1, isAuthenticated: true }],
  onSelect: () => {},
}

function renderError(message: Message, recovery?: AccountRecovery) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ErrorMessage message={message} onRetry={() => {}} accountRecovery={recovery} />
    </I18nextProvider>,
  )
}

describe('rate-limit error card', () => {
  test('shows Switch account next to Retry when a compatible alternative is available', () => {
    const markup = renderError(error, accountRecovery)
    expect(markup).toContain('>Retry</button>')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('>Switch account')
  })

  test('keeps Retry but omits Switch account when there are no alternatives', () => {
    const markup = renderError(error)
    expect(markup).toContain('>Retry</button>')
    expect(markup).not.toContain('Switch account')
  })

  test('retains Retry next to the account menu on saved errors without button actions', () => {
    const markup = renderError({ ...error, errorActions: undefined }, accountRecovery)
    expect(markup).toContain('>Retry</button>')
    expect(markup).toContain('>Switch account')
  })
})
