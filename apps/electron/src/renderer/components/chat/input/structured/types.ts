import type { PermissionRequest, CredentialRequest, CredentialResponse } from '../../../../../shared/types'

/**
 * Input mode determines which component is rendered in InputContainer
 */
export type InputMode = 'freeform' | 'structured'

/**
 * Types of structured input UIs
 */
export type StructuredInputType = 'permission' | 'credential'

/**
 * Union type for structured input data
 */
export type StructuredInputData =
  | { type: 'permission'; data: PermissionRequest }
  | { type: 'credential'; data: CredentialRequest }

/**
 * State for structured input
 */
export interface StructuredInputState {
  type: StructuredInputType
  data: PermissionRequest | CredentialRequest
}

/**
 * Response from permission request
 */
export interface PermissionResponse {
  type: 'permission'
  allowed: boolean
  alwaysAllow: boolean
}

/**
 * Union type for all structured responses
 */
export type StructuredResponse = PermissionResponse | CredentialResponse

// Re-export CredentialResponse for convenience
export type { CredentialResponse }
