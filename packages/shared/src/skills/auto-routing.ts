import type { LoadedSkill } from './types.ts'

interface SkillRoute {
  requestTerms: RegExp
  skillTerms: RegExp
}

const SKILL_ROUTES: SkillRoute[] = [
  // Jonwork business workflows. Keep these before generic file-format routes so
  // a request such as "research kettle user pain points" selects the domain
  // workflow first, then adds a document/image skill only when that format is
  // explicitly requested.
  {
    requestTerms: /(?:用户洞察|用户研究|用户调研|用户画像|体验地图|使用痛点|用户需求|使用场景|(?:这个|这款|该)?产品.{0,10}(?:适合谁|谁会用|适合(?:什么|哪些)人)|(?:帮我)?(?:看看|分析|研究).{0,12}(?:用户|人群|痛点|怎么用)|user insights?|user research|persona|journey map|who (?:would|will) use (?:this|the) product)/iu,
    skillTerms: /(?:jonwork-user-insight|用户洞察)/iu,
  },
  {
    requestTerms: /(?:竞品洞察|竞品研究|竞品调研|竞品分析|竞品差异(?:化)?(?:机会)?|竞争格局|竞品对比|(?:帮我)?看看.{0,10}(?:同行|竞品|市面上类似产品).{0,8}(?:怎么做|有哪些|优缺点)|(?:同行|竞品|市面上类似产品).{0,8}(?:怎么做|有哪些|优缺点)|competitive insights?|competitor (?:research|analysis)|competitive landscape)/iu,
    skillTerms: /(?:jonwork-competitor-insight|竞品洞察)/iu,
  },
  {
    requestTerms: /(?:设计提案|产品提案|概念提案|设计方案书|(?:帮我)?(?:出|想|做).{0,6}(?:设计方案|产品方案|产品方向|概念方向)|设计上.{0,6}(?:怎么做|怎么改)|design proposal|concept proposal)/iu,
    skillTerms: /(?:jonwork-design-proposal|设计提案)/iu,
  },
  {
    requestTerms: /(?:自定义融合|自定义模式|(?:按|照着).{0,8}(?:我的想法|我的要求).{0,12}(?:这|几张|参考)图.{0,8}(?:组合|拼|融合)|把这几张图.{0,8}(?:组合|拼|融合).{0,8}(?:一下|起来)|custom fusion)/iu,
    skillTerms: /(?:jonwork-custom-fusion|自定义模式)/iu,
  },
  {
    requestTerms: /(?:草图渲染|手绘转效果图|线稿渲染|把这张.{0,4}(?:手绘|草图|线稿).{0,8}(?:变成|做成|生成).{0,4}(?:效果图|真实图|产品图)|让这张.{0,4}(?:草图|线稿).{0,8}(?:更真实|像成品)|sketch render)/iu,
    skillTerms: /(?:jonwork-sketch-render|草图渲染)/iu,
  },
  {
    requestTerms: /(?:整图编辑|场景编辑|全图修改|把整张图.{0,10}(?:改|调整|换)|给这张图.{0,8}换(?:个|一下)?(?:背景|场景|风格)|整体.{0,6}(?:改一下|调整一下|换一下)|scene edit)/iu,
    skillTerms: /(?:jonwork-scene-edit|整图编辑)/iu,
  },
  {
    requestTerms: /(?:造型融合|形态融合|把.{0,8}(?:这个|a|A).{0,8}(?:外形|造型).{0,8}(?:和|跟).{0,8}(?:那个|b|B).{0,8}(?:结合|融合)|用.{0,8}(?:这个|它)的外形.{0,8}(?:做|改)另一个|form fusion)/u,
    skillTerms: /(?:jonwork-form-fusion|造型融合)/iu,
  },
  {
    requestTerms: /(?:局部改型|局部重绘|局部造型|只改.{0,10}(?:这里|这个地方|这部分|把手|手柄|局部)|其他地方别动|保持其他部分不变.{0,8}(?:改|调整)|local remodel)/iu,
    skillTerms: /(?:jonwork-local-remodel|局部改型)/iu,
  },
  {
    requestTerms: /(?:智能设计解构|设计解构|产品基因拆解|造型解构|(?:帮我)?(?:拆解|拆一拆|分析一下).{0,8}(?:这个|这款)产品.{0,8}(?:怎么设计|设计思路|造型特点)|看看这个产品.{0,8}(?:由什么组成|设计逻辑)|design decomposition)/iu,
    skillTerms: /(?:jonwork-design-decomposition|智能设计解构)/iu,
  },
  {
    requestTerms: /(?:cmf发散|cmf 设计|材质发散|色彩材质发散|给这个产品.{0,10}(?:换|做|出).{0,6}(?:几套|多套|不同的).{0,6}(?:颜色|材质|配色)|试试不同的.{0,6}(?:颜色|材质|表面效果)|cmf divergence)/iu,
    skillTerms: /(?:jonwork-cmf-divergence|cmf发散)/iu,
  },
  {
    requestTerms: /(?:图片转3d|图像转3d|生成3d模型|把这张图.{0,8}(?:做成|变成|生成).{0,4}3d|照着这张图.{0,8}(?:建模|做个模型)|image to 3d)/iu,
    skillTerms: /(?:jonwork-image-to-3d|图片转3d)/iu,
  },
  {
    requestTerms: /(?:pi\s*系列化|产品系列化|系列产品设计|按这个.{0,8}(?:风格|产品).{0,8}(?:做|出|设计).{0,6}(?:一套|一系列|一组)(?:系列)?产品|让这几个产品.{0,8}(?:像一家人|风格统一|形成系列)|pi series)/iu,
    skillTerms: /(?:jonwork-pi-series|pi系列化)/iu,
  },
  {
    requestTerms: /(?:方案评估|设计评估|设计健康检查|健康检查|方案打分|设计方案.{0,8}(?:检查|打分|评估)|(?:帮我)?看看.{0,8}(?:这个|这份)方案.{0,8}(?:好不好|行不行|有没有问题|哪里不好)|这个设计.{0,8}(?:靠谱吗|有问题吗|怎么样)|design health check|design evaluation)/iu,
    skillTerms: /(?:jonwork-design-health-check|方案评估)/iu,
  },
  {
    requestTerms: /(?:对标诊断|对标评估|标杆对比|(?:帮我)?(?:把|拿).{0,8}(?:这个|我的|当前)方案.{0,8}(?:和|跟).{0,8}(?:标杆|参考方案|这个参考).{0,8}(?:比一下|比较|对比)|这两个方案.{0,8}(?:比一下|差在哪|哪个好)|benchmark diagnosis|benchmark evaluation)/iu,
    skillTerms: /(?:jonwork-benchmark-diagnosis|对标诊断)/iu,
  },
  {
    requestTerms: /(?:报告|文档|方案书|研究报告|调研报告|白皮书|合同|简历|word|docx|document|proposal|brief|(?:create|write|generate|draft|prepare|make)\s+(?:an?\s+)?report|(?:research|analysis)\s+report)/iu,
    skillTerms: /(?:document|docx|word|report|writing|research|文档|报告|研究)/iu,
  },
  {
    requestTerms: /(?:pdf|便携式文档)/iu,
    skillTerms: /(?:pdf)/iu,
  },
  {
    requestTerms: /(?:表格|工作簿|电子表格|数据表|excel|xlsx|xls|csv|spreadsheet|workbook)/iu,
    skillTerms: /(?:spreadsheet|excel|xlsx|workbook|sheet|表格)/iu,
  },
  {
    requestTerms: /(?:演示文稿|幻灯片|路演|汇报稿|pptx?|presentation|slide deck|slides?)/iu,
    skillTerms: /(?:presentation|powerpoint|pptx?|slides?|演示|幻灯片)/iu,
  },
  {
    requestTerms: /(?:图片|图像|海报|插画|效果图|示意图|信息图|封面|image|illustration|poster|diagram|infographic)/iu,
    skillTerms: /(?:^|\s)(?:imagegen|image generation|image generator|图片生成|图像生成)(?:\s|$)/iu,
  },
  {
    requestTerms: /(?:视频|短片|动画|video|animation)/iu,
    skillTerms: /(?:video|animation|视频)/iu,
  },
]

const PROVIDER_SCOPED_SKILLS: Array<{ prefix: RegExp; requestMentionsProvider: RegExp }> = [
  { prefix: /^(?:lark|feishu)-/iu, requestMentionsProvider: /(?:飞书|lark|feishu)/iu },
  { prefix: /^google-/iu, requestMentionsProvider: /(?:谷歌|google)/iu },
  { prefix: /^microsoft-/iu, requestMentionsProvider: /(?:微软|microsoft)/iu },
  { prefix: /^figma-/iu, requestMentionsProvider: /figma/iu },
  { prefix: /^stripe-/iu, requestMentionsProvider: /stripe/iu },
  { prefix: /^cloudflare-/iu, requestMentionsProvider: /cloudflare/iu },
]

function searchableSkillText(skill: LoadedSkill): string {
  return `${skill.slug} ${skill.metadata.name}`
}

function isSkillInRequestScope(request: string, skill: LoadedSkill): boolean {
  const provider = PROVIDER_SCOPED_SKILLS.find(item => item.prefix.test(skill.slug))
  return !provider || provider.requestMentionsProvider.test(request)
}

export function hasDeliverableSkillIntent(request: string): boolean {
  const normalizedRequest = request.trim()
  return normalizedRequest.length > 0 && SKILL_ROUTES.some(route => route.requestTerms.test(normalizedRequest))
}

/**
 * Conservatively selects the smallest useful set of skills for a request.
 * Explicit skill mentions remain authoritative; this only covers clear output
 * business workflow or output-format intent such as reports, spreadsheets,
 * presentations, images, or video.
 */
export function matchSkillsForRequest(
  request: string,
  skills: LoadedSkill[],
  maxMatches = 3,
): LoadedSkill[] {
  const normalizedRequest = request.trim()
  if (!normalizedRequest || skills.length === 0 || maxMatches <= 0) return []

  const selected: LoadedSkill[] = []
  const selectedSlugs = new Set<string>()

  const addBestMatch = (skillTerms: RegExp) => {
    const match = skills.find(skill =>
      !selectedSlugs.has(skill.slug)
      && isSkillInRequestScope(normalizedRequest, skill)
      && skillTerms.test(searchableSkillText(skill))
    )
    if (!match) return
    selected.push(match)
    selectedSlugs.add(match.slug)
  }

  for (const route of SKILL_ROUTES) {
    if (selected.length >= maxMatches) break
    if (route.requestTerms.test(normalizedRequest)) addBestMatch(route.skillTerms)
  }

  // A user may name a skill directly without inserting a structured mention.
  if (selected.length < maxMatches) {
    const lowerRequest = normalizedRequest.toLocaleLowerCase()
    for (const skill of skills) {
      if (selected.length >= maxMatches || selectedSlugs.has(skill.slug)) continue
      const names = [skill.slug, skill.metadata.name]
        .map(value => value.trim().toLocaleLowerCase())
        .filter(value => value.length >= 3)
      if (names.some(name => lowerRequest.includes(name))) {
        selected.push(skill)
        selectedSlugs.add(skill.slug)
      }
    }
  }

  return selected
}

/**
 * Keeps the last clear deliverable intent active across terse follow-ups such
 * as "revise it" or "continue". A new explicit format request always wins.
 */
export function matchSkillsForConversation(
  currentRequest: string,
  previousUserRequests: string[],
  skills: LoadedSkill[],
  maxMatches = 3,
): LoadedSkill[] {
  const currentMatches = matchSkillsForRequest(currentRequest, skills, maxMatches)
  if (currentMatches.length > 0) return currentMatches

  for (let index = previousUserRequests.length - 1; index >= 0; index -= 1) {
    const previousMatches = matchSkillsForRequest(previousUserRequests[index] ?? '', skills, maxMatches)
    if (previousMatches.length > 0) return previousMatches
  }
  return []
}
