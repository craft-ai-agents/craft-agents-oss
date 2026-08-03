/**
 * Re-export WsRpcClient from @archstudio/server-core.
 *
 * The implementation was extracted to server-core so any package
 * (subprocesses, services, bridges) can use it without depending
 * on the Electron app layer. All existing imports continue to work.
 */
export {
  WsRpcClient,
  type WsRpcClientOptions,
  type TransportMode,
  type TransportConnectionStatus,
  type TransportConnectionErrorKind,
  type TransportConnectionError,
  type TransportCloseInfo,
  type TransportConnectionState,
} from '@archstudio/server-core/transport'
