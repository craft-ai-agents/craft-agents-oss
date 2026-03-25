import { getModelDisplayName, getModelShortName, type ModelDefinition } from '@config/models'

function stripPiPrefixForDisplay(value: string): string {
  return value.startsWith('pi/') ? value.slice(3) : value
}

export function getCurrentModelDisplayName(
  availableModels: Array<ModelDefinition | string>,
  currentModel: string,
  connectionDefaultModel?: string | null,
): string {
  const modelToDisplay = connectionDefaultModel ?? currentModel
  const model = availableModels.find((candidate) =>
    typeof candidate === 'string' ? candidate === modelToDisplay : candidate.id === modelToDisplay,
  )

  if (!model) {
    return stripPiPrefixForDisplay(getModelDisplayName(modelToDisplay))
  }

  return typeof model === 'string'
    ? stripPiPrefixForDisplay(getModelShortName(model))
    : model.name
}
