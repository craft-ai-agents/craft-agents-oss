import type { PermissionRequest as PermissionRequestType } from '../../../../shared/types'
import { PermissionRequest } from './structured/PermissionRequest'
import { ClarificationQuestion } from './structured/ClarificationQuestion'
import { PlanReview } from './structured/PlanReview'
import type {
  StructuredInputState,
  StructuredResponse,
  ClarificationQuestion as ClarificationQuestionType,
  PlanReview as PlanReviewType,
} from './structured/types'

interface StructuredInputProps {
  state: StructuredInputState
  onResponse: (response: StructuredResponse) => void
  /** When true, removes container styling (shadow, bg, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

/**
 * StructuredInput - Router component for structured input UIs
 *
 * Routes to the appropriate component based on the input type:
 * - permission: PermissionRequest
 * - clarification: ClarificationQuestion
 * - plan_review: PlanReview
 */
export function StructuredInput({ state, onResponse, unstyled = false }: StructuredInputProps) {
  switch (state.type) {
    case 'permission':
      return (
        <PermissionRequest
          request={state.data as PermissionRequestType}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    case 'clarification':
      return (
        <ClarificationQuestion
          question={state.data as ClarificationQuestionType}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    case 'plan_review':
      return (
        <PlanReview
          plan={state.data as PlanReviewType}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    default:
      return null
  }
}
