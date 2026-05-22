import type { OutputManifestDTO } from '@/hooks/useOutputs'
import {
  isLocalWebPreviewUrl as isSharedLocalWebPreviewUrl,
  resolveLocalWebPreviewTarget,
  type WebPreviewPolicyOptions,
} from '@craft-agent/shared/outputs/web-preview'

export interface WebPreviewTarget {
  url: string
  label: string
  displayHost: string
}

export function isLocalWebPreviewUrl(value: string | undefined, options: WebPreviewPolicyOptions = {}): boolean {
  return isSharedLocalWebPreviewUrl(value, options)
}

export function resolveWebPreviewTarget(manifest: OutputManifestDTO, options: WebPreviewPolicyOptions = {}): WebPreviewTarget | null {
  return resolveLocalWebPreviewTarget(manifest, options)
}
