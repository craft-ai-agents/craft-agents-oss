#!/usr/bin/env bun
/**
 * Test API server for team public knowledge documents.
 *
 * Usage:
 *   bun run scripts/test-team-knowledge-api.ts
 *
 * Endpoints:
 *   GET /api/team/knowledge
 *   GET /api/team/knowledge/:id
 */

export interface TestTeamKnowledgeDocument {
  /** Stable document identifier used in the mock index and document route. */
  id: string;
  /** Human-readable title returned by the mock index. */
  title: string;
  /** Sort priority returned by the mock index. */
  priority: number;
  /** Markdown body returned by the mock document route. */
  markdown: string;
}

/** Port used by the team knowledge mock API server. */
export const TEAM_KNOWLEDGE_API_PORT = 3100;

/** Mock team knowledge documents covering the four supported entry kinds. */
export const TEAM_KNOWLEDGE_DOCUMENTS: TestTeamKnowledgeDocument[] = [
  {
    id: 'terminology',
    title: '术语俚语',
    priority: 1,
    markdown: `# 术语俚语

<!-- term name:花豹 summary:前端性能监控系统 -->
花豹是团队使用的前端性能监控系统，用于查看页面加载、接口耗时和前端异常。

<!-- term name:天眼 summary:生产监控与告警平台 -->
天眼是生产监控与告警平台，用于查看服务健康状态、告警和关键业务指标。

<!-- term name:owl summary:日志检索与排障平台 -->
owl 是日志检索与排障平台，排查问题时优先通过 traceId 或关键字定位日志。

<!-- term name:受托 summary:受托支付业务流程 -->
受托指受托支付业务流程，涉及资金发放、收款方校验和支付结果核对。

<!-- term name:乐高 summary:低代码配置平台 -->
乐高是低代码配置平台，用于搭建表单、流程和运营配置页面。
`,
  },
  {
    id: 'common-knowledge',
    title: '基本常识',
    priority: 2,
    markdown: `# 基本常识

<!-- knowledge name:灰度时间 summary:手机银行灰度一般为周三到周二 -->
手机银行灰度一般从周三开始，到下周二结束。涉及灰度节奏的问题需要确认当前版本计划。

<!-- knowledge name:下班时间 summary:常规下班时间为 18:00 -->
团队常规下班时间为 18:00，紧急发布或生产问题需要按值班安排处理。

<!-- knowledge name:负责部门 summary:跨系统问题先确认归属部门 -->
跨系统问题先确认归属部门，再联系对应负责人推进定位。
`,
  },
  {
    id: 'notices',
    title: '公告通知',
    priority: 3,
    markdown: `# 公告通知

<!-- notice name:规范着装 summary:规范着装 -->
进入办公区、会议室和客户现场需要规范着装，避免穿拖鞋、背心等不合适服饰。

<!-- notice name:安全漏洞 summary:安全漏洞必须当天响应 -->
发现安全漏洞必须当天响应，先止血、再评估影响范围并补充复盘记录。

<!-- notice name:黄赌毒 summary:黄赌毒相关内容零容忍 -->
黄赌毒相关内容零容忍，发现后立即升级安全与合规负责人处理。
`,
  },
  {
    id: 'constraints',
    title: '约束规定',
    priority: 4,
    markdown: `# 约束规定

<!-- rule name:性能问题 summary:性能问题必须区分前端和后端 -->
分析性能问题时必须先区分前端、网络和后端耗时，不能直接把问题归因到单一系统。

<!-- rule name:查负责人 summary:处理问题前先查负责人 -->
处理跨模块问题前先查负责人和归属系统，避免把工单转给无关团队。

<!-- rule name:实事求是 summary:不能瞎猜、实事求是 -->
不确定的信息不能瞎猜，必须说明不确定性，并基于日志、监控或负责人确认结果作答。
`,
  },
];

const documentsById = new Map(TEAM_KNOWLEDGE_DOCUMENTS.map(document => [document.id, document]));

/** Handles mock team knowledge API requests for the standalone server and tests. */
export function handleTeamKnowledgeApiRequest(request: Request): Response {
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (url.pathname === '/api/team/knowledge') {
    return jsonResponse(TEAM_KNOWLEDGE_DOCUMENTS.map(document => ({
      id: document.id,
      title: document.title,
      priority: document.priority,
      url: `http://localhost:${TEAM_KNOWLEDGE_API_PORT}/api/team/knowledge/${document.id}`,
    })));
  }

  const match = url.pathname.match(/^\/api\/team\/knowledge\/([^/]+)$/);
  if (!match) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const document = documentsById.get(decodeURIComponent(match[1]!));
  if (!document) {
    return jsonResponse({ error: 'Knowledge document not found' }, 404);
  }

  return new Response(document.markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

if (import.meta.main) {
  const server = Bun.serve({
    port: TEAM_KNOWLEDGE_API_PORT,
    fetch: handleTeamKnowledgeApiRequest,
  });

  console.log(`Team knowledge test API listening on http://localhost:${server.port}`);
  console.log(`Serving ${TEAM_KNOWLEDGE_DOCUMENTS.length} documents:`);
  for (const document of TEAM_KNOWLEDGE_DOCUMENTS) {
    console.log(`  ${document.priority}. ${document.id} - ${document.title}`);
  }
}
