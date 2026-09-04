import type { CanvasUpdate } from '@craft-agent/session-tools-core/canvas-store'

/** Validate the queued business contract, not a count supplied in a renderer receipt. */
export function canvasBusinessArtifacts(entry: CanvasUpdate, artifacts: unknown): unknown[] {
  const brief = (entry.ops.find(op => op.type === 'add_node' && (op.metadata as any)?.businessBrief)?.metadata as any)?.businessBrief
    ?? entry.ops.find(op => op.type === 'run_model_generation')?.brief as any
  if (!brief) return artifacts as unknown[] // legacy/free-form operations retain their existing contract
  if (!Array.isArray(artifacts)) throw new Error('未收到真实业务成果。')
  const model = entry.ops.some(op => op.type === 'run_model_generation')
  const text = entry.ops.some(op => op.type === 'run_generation' && op.mode === 'text')
  const expected = model ? 1 : entry.ops.filter(op => op.type === 'run_generation').reduce((count, op) => count + Number(op.expectedOutputCount || 0), 0)
  if (artifacts.length !== expected || artifacts.some(item => !item || (model ? item.mimeType !== 'model/gltf-binary' : text ? item.mimeType !== 'text/markdown' : !['image/png', 'image/jpeg', 'image/webp'].includes(item.mimeType)))) throw new Error(`业务成果类型或数量不符：要求${expected}项，不能将部分结果标记为完成。`)
  const spec = `# ${brief.name}：需求与交付记录\n\n状态：待用户审查\n\n## 已确认需求\n${brief.requirements}\n\n## 输入及约束\n${brief.inputRoles}\n${brief.rules}\n\n${brief.materialsNote ? `## 材料与来源\n${brief.materialsNote}\n\n` : ''}${brief.identityRules ? `## PI共享规则\n${brief.identityRules}\n\n## 10款对应成果顺序\n${brief.seriesPlan.map((item: string, index: number) => `${index + 1}. ${item}`).join('\n')}\n\n` : ''}## 验收\n请打开全部成果，检查需求、保留约束、证据与质量，再在成果版本栏批准或填写修改意见。文件格式与数量校验不代表内容、视觉或工程验收通过。\n`
  const state = { schemaVersion: 1, module: brief.module, revision: entry.revision, status: 'pending_review', brief: { confirmed: true, confirmedAt: entry.createdAt, ...brief }, upstream: entry.upstream ?? null, outputCount: expected, validation: { fileContractChecked: true, businessQualityPassed: false }, approval: { approved: false, records: 'review-*.json（以最新版本记录为准）' } }
  return [...artifacts, { mimeType: 'text/markdown', text: spec }, { mimeType: 'application/json', text: JSON.stringify(state, null, 2) }]
}
