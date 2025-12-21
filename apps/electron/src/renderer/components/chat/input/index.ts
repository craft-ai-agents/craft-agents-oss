// Main components
export { InputContainer } from './InputContainer'
export { FreeFormInput } from './FreeFormInput'
export { StructuredInput } from './StructuredInput'

// Structured input components
export { PermissionRequest } from './structured/PermissionRequest'
export { ClarificationQuestion } from './structured/ClarificationQuestion'
export { PlanReview } from './structured/PlanReview'

// Hooks
export { useAutoGrow } from './useAutoGrow'

// Types
export type {
  InputMode,
  StructuredInputType,
  StructuredInputState,
  StructuredInputData,
  StructuredResponse,
  PermissionResponse,
  ClarificationQuestion as ClarificationQuestionType,
  ClarificationOption,
  ClarificationResponse,
  PlanReview as PlanReviewType,
  PlanStep,
  PlanReviewResponse,
} from './structured/types'
