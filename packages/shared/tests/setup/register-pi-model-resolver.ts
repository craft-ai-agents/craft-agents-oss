import { registerPiModelResolver } from '../../src/config/llm-connections.ts'
import { getAllPiModels, getPiModelsForAuthProvider } from '../../src/config/models-pi.ts'

registerPiModelResolver((piAuthProvider?: string) =>
  piAuthProvider ? getPiModelsForAuthProvider(piAuthProvider) : getAllPiModels(),
)
