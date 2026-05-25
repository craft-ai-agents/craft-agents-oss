import { describe, expect, mock, test } from 'bun:test'

const defaultHandle = mock((_scheme: string, _handler: (request: Request) => Promise<Response>) => {})
const partitionHandle = mock((_scheme: string, _handler: (request: Request) => Promise<Response>) => {})
const fromPartition = mock((_partition: string) => ({
  protocol: {
    handle: partitionHandle,
  },
}))

mock.module('electron', () => ({
  protocol: {
    handle: defaultHandle,
  },
  session: {
    fromPartition,
  },
}))

mock.module('../logger', () => ({
  mainLog: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) },
}))

const { registerOutputAssetHandler } = await import('../output-asset-protocol')
const { BROWSER_PANE_SESSION_PARTITION } = await import('../browser-pane-constants')
const { RUNNER_OUTPUT_SCHEME } = await import('@craft-agent/shared/outputs')

describe('registerOutputAssetHandler', () => {
  test('registers runner-output on the default and browser-pane protocol sessions', () => {
    defaultHandle.mockClear()
    partitionHandle.mockClear()
    fromPartition.mockClear()

    registerOutputAssetHandler()

    expect(defaultHandle).toHaveBeenCalledWith(RUNNER_OUTPUT_SCHEME, expect.any(Function))
    expect(fromPartition).toHaveBeenCalledWith(BROWSER_PANE_SESSION_PARTITION)
    expect(partitionHandle).toHaveBeenCalledWith(RUNNER_OUTPUT_SCHEME, expect.any(Function))
  })
})
