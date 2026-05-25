import type { OutputAssetDTO, OutputManifestDTO, OutputPreviewMode } from '@/hooks/useOutputs'

export function resolvePresentationPreviewAsset(
  manifest: OutputManifestDTO,
  currentAsset: OutputAssetDTO | undefined,
  inferPreviewMode: (asset?: OutputAssetDTO) => OutputPreviewMode,
): OutputAssetDTO | undefined {
  const candidates = manifest.assets.filter((asset) => asset.id !== currentAsset?.id && isRenderablePresentationPreviewAsset(asset, inferPreviewMode))
  return candidates.find((asset) => inferPreviewMode(asset) === 'pdf')
    ?? candidates.find(isNamedPresentationPreviewAsset)
    ?? candidates.find((asset) => asset.role === 'thumbnail')
    ?? candidates[0]
}

function isRenderablePresentationPreviewAsset(
  asset: OutputAssetDTO | undefined,
  inferPreviewMode: (asset?: OutputAssetDTO) => OutputPreviewMode,
): boolean {
  if (!asset) return false
  const mode = inferPreviewMode(asset)
  return mode === 'pdf' || mode === 'image'
}

function isNamedPresentationPreviewAsset(asset?: OutputAssetDTO): boolean {
  const label = asset?.label.toLowerCase() ?? ''
  const path = asset?.path.toLowerCase() ?? ''
  return /(^|[-_/ .])(deck|slides?|presentation|preview|export)([-_/ .]|$)/.test(`${label} ${path}`)
}
