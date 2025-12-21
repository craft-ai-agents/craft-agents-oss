import type { PermissionRequest } from '../../../../../shared/types'

/**
 * Input mode determines which component is rendered in InputContainer
 */
export type InputMode = 'freeform' | 'structured'

/**
 * Types of structured input UIs
 */
export type StructuredInputType =
  | 'permission'
  | 'clarification'
  | 'plan_review'

/**
 * Option for clarification questions
 */
export interface ClarificationOption {
  label: string
  description: string
}

/**
 * Clarification question from the agent
 */
export interface ClarificationQuestion {
  id: string
  question: string
  header?: string
  options: ClarificationOption[]
  multiSelect: boolean
}

/**
 * Step in a plan review
 */
export interface PlanStep {
  description: string
  tools?: string[]
}

/**
 * Plan review from the agent
 */
export interface PlanReview {
  id: string
  title: string
  summary: string
  steps: PlanStep[]
  questions?: string[]
}

/**
 * Union type for structured input data
 */
export type StructuredInputData =
  | { type: 'permission'; data: PermissionRequest }
  | { type: 'clarification'; data: ClarificationQuestion }
  | { type: 'plan_review'; data: PlanReview }

/**
 * State for structured input
 */
export interface StructuredInputState {
  type: StructuredInputType
  data: PermissionRequest | ClarificationQuestion | PlanReview
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
 * Response from clarification question
 */
export interface ClarificationResponse {
  type: 'clarification'
  questionId: string
  selectedOptions: number[]
  skipped: boolean
}

/**
 * Response from plan review
 */
export interface PlanReviewResponse {
  type: 'plan_review'
  planId: string
  action: 'approve' | 'refine' | 'cancel'
  feedback?: string
}

/**
 * Union type for all structured responses
 */
export type StructuredResponse =
  | PermissionResponse
  | ClarificationResponse
  | PlanReviewResponse
