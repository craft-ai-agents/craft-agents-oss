export const CANVAS_REVIEW_CHECKS = [
  { id: 'opened', label: '已打开并检查本版本的全部成果' },
  { id: 'requirements', label: '成果满足本次业务要求，关键内容已核对' },
  { id: 'constraints', label: '需要保留的特征、证据及约束已核对' },
  { id: 'handoff', label: '同意将本版本作为后续业务的输入' },
] as const

export interface CanvasReviewRequest {
  requestId: string
  expectedVersion: number
  decision: 'approved' | 'changes_requested'
  comment: string
  checks: string[]
}
export interface CanvasReview extends CanvasReviewRequest {
  version: number
  reviewedAt: string
  artifactDigest: string
}
export function validateCanvasReview(request: CanvasReviewRequest) {
  if (!request || !/^[\w-]{16,128}$/.test(request.requestId) || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 0) throw new Error('审查请求无效，请刷新成果列表。')
  if (!['approved', 'changes_requested'].includes(request.decision)) throw new Error('请选择批准或要求修改。')
  if (typeof request.comment !== 'string' || request.comment.length > 4000) throw new Error('修改意见不能超过4000字。')
  if (!Array.isArray(request.checks) || new Set(request.checks).size !== request.checks.length || request.checks.some(id => !CANVAS_REVIEW_CHECKS.some(check => check.id === id))) throw new Error('审查检查项无效。')
  if (request.decision === 'approved' && CANVAS_REVIEW_CHECKS.some(check => !request.checks.includes(check.id))) throw new Error('请逐项检查并确认全部验收项，再批准本版本。')
  if (request.decision === 'changes_requested' && !request.comment.trim()) throw new Error('请填写具体修改意见，便于在原任务继续处理。')
}
