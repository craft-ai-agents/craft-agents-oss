import { describe, expect, it } from 'bun:test'

import { hasDeliverableSkillIntent, matchSkillsForConversation, matchSkillsForRequest } from '../auto-routing.ts'
import type { LoadedSkill } from '../types.ts'

function skill(slug: string, name: string, description: string): LoadedSkill {
  return {
    slug,
    metadata: { name, description },
    content: '',
    path: `/skills/${slug}`,
    source: 'global',
  }
}

const available = [
  skill('documents', 'Documents', 'Create and edit Word documents and reports.'),
  skill('pdf', 'PDF', 'Create and validate PDF files.'),
  skill('spreadsheets', 'Spreadsheets', 'Create Excel workbooks and spreadsheets.'),
  skill('presentations', 'Presentations', 'Create PowerPoint slide decks.'),
  skill('imagegen', 'Image generation', 'Generate and edit images.'),
]

const jonwork = [
  skill('jonwork-user-insight', '用户洞察', 'Research users, scenarios, pain points, and opportunities.'),
  skill('jonwork-competitor-insight', '竞品洞察', 'Analyze competitors and differentiation opportunities.'),
  skill('jonwork-design-proposal', '设计提案', 'Create an evidence-backed design proposal.'),
  skill('jonwork-custom-fusion', '自定义模式', 'Fuse product references with custom controls.'),
  skill('jonwork-sketch-render', '草图渲染', 'Render a sketch into a product visualization.'),
  skill('jonwork-scene-edit', '整图编辑', 'Edit a complete product scene.'),
  skill('jonwork-form-fusion', '造型融合', 'Fuse product forms.'),
  skill('jonwork-local-remodel', '局部改型', 'Remodel a selected product region.'),
  skill('jonwork-design-decomposition', '智能设计解构', 'Decompose product and reference images.'),
  skill('jonwork-cmf-divergence', 'CMF发散', 'Generate color, material, and finish directions.'),
  skill('jonwork-image-to-3d', '图片转3D', 'Create a 3D model from a product image.'),
  skill('jonwork-pi-series', 'PI系列化', 'Create a coherent product family.'),
  skill('jonwork-design-health-check', '方案评估', 'Evaluate a design against acceptance criteria.'),
  skill('jonwork-benchmark-diagnosis', '对标诊断', 'Compare a design with a benchmark.'),
]

describe('matchSkillsForRequest', () => {
  it('routes explicit deliverable formats to a minimal skill set', () => {
    expect(matchSkillsForRequest('请根据材料生成一份调研报告 PDF', available).map(item => item.slug))
      .toEqual(['documents', 'pdf'])
    expect(matchSkillsForRequest('做一个 Excel 数据表', available).map(item => item.slug))
      .toEqual(['spreadsheets'])
    expect(matchSkillsForRequest('生成产品海报图片', available).map(item => item.slug))
      .toEqual(['imagegen'])
  })

  it('routes natural business intent to Jonwork workflows without requiring an explicit skill name', () => {
    const allSkills = [...jonwork, ...available]

    expect(matchSkillsForRequest('研究家用电热水壶用户痛点和使用场景', allSkills).map(item => item.slug))
      .toEqual(['jonwork-user-insight'])
    expect(matchSkillsForRequest('分析电热水壶竞品差异化机会并生成 PDF', allSkills).map(item => item.slug))
      .toEqual(['jonwork-competitor-insight', 'pdf'])
    expect(matchSkillsForRequest('把这张产品线稿做成草图渲染效果图', allSkills).map(item => item.slug))
      .toEqual(['jonwork-sketch-render', 'imagegen'])
    expect(matchSkillsForRequest('对当前设计方案做健康检查和打分', allSkills).map(item => item.slug))
      .toEqual(['jonwork-design-health-check'])
    expect(matchSkillsForRequest(
      '请完成“方案评估”模块验收。先检查材料并询问缺失参数，再生成报告，最后按验收标准检查。',
      allSkills,
    ).map(item => item.slug)).toEqual(['jonwork-design-health-check', 'documents'])
  })

  it('routes short conversational requests and lets the skill collect missing details', () => {
    const allSkills = [...jonwork, ...available]

    const cases: Array<[string, string]> = [
      ['帮我看看这个产品适合谁、有什么痛点', 'jonwork-user-insight'],
      ['帮我看看同行的类似产品都有哪些、做得怎么样', 'jonwork-competitor-insight'],
      ['帮我想几个产品方向', 'jonwork-design-proposal'],
      ['按我的想法把这几张参考图组合起来', 'jonwork-custom-fusion'],
      ['把这张手绘草图做成真实效果图', 'jonwork-sketch-render'],
      ['给这张图换个背景和整体风格', 'jonwork-scene-edit'],
      ['把这个产品的外形和那个产品的造型结合一下', 'jonwork-form-fusion'],
      ['只改这个地方，其他地方别动', 'jonwork-local-remodel'],
      ['帮我拆解一下这个产品的设计思路', 'jonwork-design-decomposition'],
      ['给这个产品做几套不同的颜色和材质', 'jonwork-cmf-divergence'],
      ['照着这张图做个模型', 'jonwork-image-to-3d'],
      ['按这个风格做一套系列产品', 'jonwork-pi-series'],
      ['帮我看看这个方案好不好，有没有问题', 'jonwork-design-health-check'],
      ['把我的方案和这个标杆比一下', 'jonwork-benchmark-diagnosis'],
    ]

    for (const [request, expected] of cases) {
      expect(matchSkillsForRequest(request, allSkills)[0]?.slug).toBe(expected)
    }

    expect(matchSkillsForRequest('帮我看看这个产品', allSkills)).toEqual([])
  })

  it('keeps concept-image delivery separate from image-to-3d', () => {
    const allSkills = [...jonwork, ...available]
    const request = '生成家用电热水壶用户洞察，并为后续竞品洞察、设计提案和概念效果图建立验收标准'

    expect(matchSkillsForRequest(request, allSkills, 5).map(item => item.slug))
      .toEqual([
        'jonwork-user-insight',
        'jonwork-competitor-insight',
        'jonwork-design-proposal',
        'imagegen',
      ])
    expect(matchSkillsForRequest(request, allSkills, 5).map(item => item.slug))
      .not.toContain('jonwork-image-to-3d')
  })

  it('covers every migrated H5 menu intent with its Craft skill', () => {
    const cases: Array<[string, string]> = [
      ['分析目标用户画像', 'jonwork-user-insight'],
      ['研究竞品竞争格局', 'jonwork-competitor-insight'],
      ['生成工业设计提案', 'jonwork-design-proposal'],
      ['运行自定义融合模式', 'jonwork-custom-fusion'],
      ['把线稿做草图渲染', 'jonwork-sketch-render'],
      ['对产品场景做整图编辑', 'jonwork-scene-edit'],
      ['将两个参考产品做造型融合', 'jonwork-form-fusion'],
      ['只对手柄区域局部改型', 'jonwork-local-remodel'],
      ['先做智能设计解构', 'jonwork-design-decomposition'],
      ['发散三套 CMF 设计', 'jonwork-cmf-divergence'],
      ['把产品图片转3D模型', 'jonwork-image-to-3d'],
      ['生成十款 PI 系列化产品', 'jonwork-pi-series'],
      ['给当前设计方案打分', 'jonwork-design-health-check'],
      ['对当前方案做标杆对比', 'jonwork-benchmark-diagnosis'],
    ]

    for (const [request, expected] of cases) {
      expect(matchSkillsForRequest(request, jonwork)[0]?.slug).toBe(expected)
    }
  })

  it('matches a directly named skill and avoids guessing for generic chat', () => {
    expect(matchSkillsForRequest('请使用 Presentations 制作内容', available).map(item => item.slug))
      .toEqual(['presentations'])
    expect(matchSkillsForRequest('你好，帮我想想', available)).toEqual([])
    expect(matchSkillsForRequest('Report a bug in the settings page', available)).toEqual([])
  })

  it('deduplicates matches and respects the maximum', () => {
    expect(matchSkillsForRequest('报告、PDF、表格、PPT 和图片', available, 2).map(item => item.slug))
      .toEqual(['documents', 'pdf'])
  })

  it('inherits the latest clear deliverable intent for terse follow-ups', () => {
    expect(matchSkillsForConversation(
      '继续修改标题并生成',
      ['先帮我做一份用户调研报告 PDF', '标题面向管理层'],
      available,
    ).map(item => item.slug)).toEqual(['documents', 'pdf'])

    expect(matchSkillsForConversation(
      '改成图片海报',
      ['先帮我做一份用户调研报告 PDF'],
      available,
    ).map(item => item.slug)).toEqual(['imagegen'])
  })

  it('does not route from incidental words in an unrelated skill description', () => {
    const unrelated = [
      skill('lark-apps', 'Lark Apps', 'Build apps, reports, presentations, and images in Lark.'),
      skill('lark-base', 'Lark Base', 'Create data tables and dashboards.'),
    ]

    expect(matchSkillsForRequest('生成用户调研报告 PDF', unrelated)).toEqual([])
    expect(matchSkillsForRequest('制作 Excel 数据表', unrelated)).toEqual([])
    expect(matchSkillsForRequest('生成产品海报图片', unrelated)).toEqual([])
  })

  it('uses provider-scoped skills only when that provider is requested', () => {
    const larkSkills = [skill('lark-sheets', 'Lark Sheets', 'Create spreadsheets in Feishu.')]
    expect(matchSkillsForRequest('制作 Excel 数据表', larkSkills)).toEqual([])
    expect(matchSkillsForRequest('在飞书里制作 Excel 数据表', larkSkills).map(item => item.slug))
      .toEqual(['lark-sheets'])
  })

  it('detects a deliverable intent even when no matching skill is installed', () => {
    expect(hasDeliverableSkillIntent('请生成产品海报图片')).toBe(true)
    expect(hasDeliverableSkillIntent('你好，讨论一下产品方向')).toBe(false)
  })
})
