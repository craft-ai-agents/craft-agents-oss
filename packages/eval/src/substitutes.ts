/**
 * 替代料判分逻辑 —— 提纯成纯函数,便于脱离 agent/Phoenix 直接 `bun test`。
 * Phoenix evaluator(evaluators.ts)只是薄薄地调这里,判分仍跑在 Phoenix 实验上。
 *
 * 设计要点(见对话定稿):
 * - 语义等价(基础型号 vs 含封装/卷带/温度后缀的订货号)绝不进代码 —— 由 labeled
 *   集列出厂商标准 OPN 写法,evaluator 只做精确成员判定。
 * - surfaceCanon 只做"无损表面规范",禁止任何改变型号身份的操作。
 * - closed 集:minPrecision 默认 1.0(推荐的每一个都必须在 acceptable 内)。
 */

export interface SubstitutesExpected {
  /** 可接受替代的厂商标准 OPN 集合(closed)。 */
  acceptable: string[];
  /**
   * 必须命中的关键替代(recall 底线)。缺省则 recall 恒为 1。
   * 每项是一颗必须找到的料;若该料有多种等价写法(同料不同印法,如 Molex
   * `534260410` = `53426-0410`),写成别名组 `["534260410", "53426-0410"]`,
   * 命中组内任一即算找到这颗料。普通单写法仍直接写字符串。
   */
  mustFind?: (string | string[])[];
  /** 明确错误的料,推了直接判挂。 */
  forbidden?: string[];
  /** precision 阈值,默认 1.0(closed 严格)。 */
  minPrecision?: number;
}

export interface SubstituteItem {
  mpn: string;
  [key: string]: unknown;
}

export interface SubstitutesPayload {
  original?: string;
  substitutes?: SubstituteItem[];
}

/**
 * 无损表面规范化 —— 唯一允许进 evaluator 的归一化。
 *
 * 只做不改变型号身份的操作:
 *   - NFKC:全角→半角(全角空格 U+3000→空格、：→: 等)
 *   - 折叠连续空白为单个(不删除内部空白:有无空格可能是不同写法,宁可漏判)
 *   - 大小写折叠(OPN 实务上大小写不敏感)
 *
 * 禁止:剥后缀、删 `-`/`.`/`:`、判型号族。那是语义判断,归 labeled 集。
 */
export function surfaceCanon(raw: string): string {
  return (raw ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * 从最终回答里抠出 ```<kind> 栅栏 JSON 块并解析。
 * 取第一个匹配块;缺块或 JSON 畸形 → null(判分侧据此判挂)。
 */
export function parseFencedBlock(text: string, kind: string): unknown | null {
  const fence = new RegExp('```' + kind + '[^\\n]*\\n([\\s\\S]*?)```');
  const match = (text ?? '').match(fence);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * 按"内容形状"抠出替代料答案块,不认死栅栏标签。
 *
 * 实测:模型时而写 ```substitutes,时而写 ```json,时而裸 ```。标签是表面噪声,
 * 不该决定是否判 0 分。规则:扫所有 fenced 块,取第一个能 JSON.parse 成对象、
 * 且带 `substitutes` 数组的块。这样标签写成什么都不影响判分。
 */
export function extractSubstitutesPayload(text: string): SubstitutesPayload | null {
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  for (const m of (text ?? '').matchAll(fence)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as SubstitutesPayload).substitutes)) {
      return parsed as SubstitutesPayload;
    }
  }
  return null;
}

export interface SubstitutesScore {
  pass: boolean;
  recall: number;
  precision: number;
  recommended: string[];
  hit: string[];
  missedMustFind: string[];
  forbiddenHit: string[];
  reason: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * closed 集判分:recall(关键替代找到没)+ precision(有没有瞎推)+ 禁止项。
 * 偏向漏判:over-normalize 会静默假阳性,这里只用 surfaceCanon 的无损规范。
 */
export function scoreSubstitutes(
  payload: SubstitutesPayload | null,
  expected: SubstitutesExpected
): SubstitutesScore {
  const minPrecision = expected.minPrecision ?? 1;
  // 每个 mustFind 项 = 一颗必须找到的料,可有多种等价写法(别名组);命中组内任一即算找到
  const mustGroups = (expected.mustFind ?? []).map((item) =>
    unique((Array.isArray(item) ? item : [item]).map(surfaceCanon))
  );
  // 别名本身也是可接受写法 → 并入 acceptable,precision 不冤枉
  const acceptable = new Set([
    ...(expected.acceptable ?? []).map(surfaceCanon),
    ...mustGroups.flat(),
  ]);
  const forbidden = new Set((expected.forbidden ?? []).map(surfaceCanon));

  if (!payload || !Array.isArray(payload.substitutes)) {
    return {
      pass: false,
      recall: mustGroups.length ? 0 : 1,
      precision: 0,
      recommended: [],
      hit: [],
      missedMustFind: mustGroups.map((g) => g[0]),
      forbiddenHit: [],
      reason: 'agent 没交卷:缺 substitutes 栅栏块或 JSON 畸形',
    };
  }

  const recommended = unique(
    payload.substitutes.map((item) => surfaceCanon(item?.mpn ?? '')).filter(Boolean)
  );
  const recSet = new Set(recommended);
  const hit = recommended.filter((mpn) => acceptable.has(mpn));
  const forbiddenHit = recommended.filter((mpn) => forbidden.has(mpn));
  // 一组别名里命中任一,这颗料就算找到;全没命中才记为漏(报代表写法)
  const missedMustFind = mustGroups.filter((aliases) => !aliases.some((a) => recSet.has(a))).map((g) => g[0]);

  const recall = mustGroups.length ? (mustGroups.length - missedMustFind.length) / mustGroups.length : 1;
  const precision = recommended.length
    ? hit.length / recommended.length
    : acceptable.size === 0
      ? 1
      : 0;

  const failures: string[] = [];
  if (forbiddenHit.length) failures.push(`踩禁止项: ${forbiddenHit.join(', ')}`);
  if (missedMustFind.length) failures.push(`漏关键替代: ${missedMustFind.join(', ')}`);
  if (precision < minPrecision) failures.push(`precision ${precision.toFixed(2)} < ${minPrecision}`);

  const pass = failures.length === 0;
  return {
    pass,
    recall,
    precision,
    recommended,
    hit,
    missedMustFind,
    forbiddenHit,
    reason: pass ? 'substitutes 契约满足' : failures.join('; '),
  };
}
