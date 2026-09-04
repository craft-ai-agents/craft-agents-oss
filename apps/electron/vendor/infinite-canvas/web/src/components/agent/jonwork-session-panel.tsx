import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Maximize2, Minimize2, Send } from "lucide-react";

import { useAgentStore } from "@/stores/use-agent-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CANVAS_WORKFLOWS, planCanvasWorkflow } from '../../../../../../../../packages/session-tools-core/src/canvas-workflows';
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from '@/components/canvas/canvas-node-mask-edit-dialog';

const SOURCE = "jonwork-infinite-canvas";

export function JonworkSessionPanel({ maximized, onToggleMaximize }: { maximized: boolean; onToggleMaximize: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const snapshot = useAgentStore((state) => state.canvasContext?.snapshot);
    const [prompt, setPrompt] = useState("");
    const [sending, setSending] = useState(false);
    const [lastSessionId, setLastSessionId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [workflowId, setWorkflowId] = useState('');
    const [count, setCount] = useState(1);
    const [materialsNote, setMaterialsNote] = useState('');
    const [identityRules, setIdentityRules] = useState('');
    const [seriesPlan, setSeriesPlan] = useState('');
    const [briefConfirmed, setBriefConfirmed] = useState(false);
    const [upstreamRevision, setUpstreamRevision] = useState<number | undefined>();
    const [maskDraft, setMaskDraft] = useState<{ projectId: string; nodeId: string; dataUrl: string; prompt: string } | null>(null);
    const workflow = CANVAS_WORKFLOWS.find(item => item.id === workflowId);
    const selectedImages = (snapshot?.selectedNodeIds || []).map(id => snapshot?.nodes.find(node => node.id === id)).filter(node => node?.type === 'image');
    const cleanup = useRef<(() => void) | null>(null);
    useEffect(() => { setBriefConfirmed(false); }, [prompt, workflowId, count, materialsNote, identityRules, seriesPlan, snapshot?.projectId, JSON.stringify(snapshot?.selectedNodeIds)]);
    useEffect(() => () => cleanup.current?.(), []);
    useEffect(() => { cleanup.current?.(); setLastSessionId(null); setSending(false); setError(''); setMaskDraft(null); setUpstreamRevision(undefined); }, [snapshot?.projectId]);
    useEffect(() => {
        const prepare = (event: MessageEvent) => {
            const message = event.data;
            if (event.source === window.parent && message?.source === SOURCE && message.type === 'select-workflow' && CANVAS_WORKFLOWS.some(item => item.id === message.workflowId)) {
                if (sending) { setError('当前任务正在提交，请完成后再切换业务。'); return; }
                if ((prompt.trim() || maskDraft) && !window.confirm('切换业务会清空未提交的要求和圈选草稿，继续？')) return;
                setWorkflowId(message.workflowId); setPrompt(''); setMaskDraft(null); setError(''); setCount(1); setBriefConfirmed(false); setUpstreamRevision(undefined);
                useAgentStore.getState().openPanel(); return;
            }
            if (event.source !== window.parent || message?.source !== SOURCE || message.type !== 'prepare-business-input' || message.projectId !== snapshot?.projectId) return;
            if (sending) { setError('当前任务正在提交，请稍后再选择成果。'); return; }
            if ((prompt.trim() || maskDraft) && !window.confirm('使用该成果会替换当前未提交的要求和圈选草稿，继续？')) return;
            setMaskDraft(null); setError(''); setCount(1);
            setLastSessionId(message.sessionId);
            setUpstreamRevision(message.upstreamRevision ?? (!message.revisionRequest ? message.revision : undefined));
            const original = message.workflow;
            const next = original?.id === 'user-insight' ? 'competitor-insight' : original?.id === 'competitor-insight' ? 'design-proposal' : message.imageResult ? 'scene-edit' : 'design-proposal';
            setWorkflowId(message.revisionRequest && original ? original.id : next);
            setPrompt(message.revisionRequest ? `${original?.requirements || ''}\n修改意见：${String(message.comment || '')}`.slice(0, 4000) : '');
            setMaterialsNote(message.revisionRequest ? original?.materialsNote || '' : message.imageResult ? '' : `承接成果 #${message.revision}；已批准报告会由服务端读取。请在此补充其他来源或说明资料缺口。`);
            setIdentityRules(message.revisionRequest ? original?.identityRules || '' : '');
            setSeriesPlan(message.revisionRequest ? (original?.seriesPlan || []).join('\n') : '');
            if (message.revisionRequest) setCount(original?.count || 1);
            setBriefConfirmed(false);
            const nodeIds = (Array.isArray(message.nodeIds) ? message.nodeIds : []).filter((id: string) => snapshot?.nodes.some(node => node.id === id));
            useAgentStore.getState().canvasContext?.applyOps?.([{ type: 'select_nodes', ids: nodeIds }]);
            useAgentStore.getState().openPanel();
            if (message.imageResult && !nodeIds.length) setError('原成果节点已删除。请从成果文件夹重新导入所需图片，或回原任务继续处理。');
        };
        window.addEventListener('message', prepare);
        return () => window.removeEventListener('message', prepare);
    }, [snapshot, sending, prompt, maskDraft]);

    const submit = (mask?: CanvasImageMaskEditPayload) => {
        const content = (mask?.prompt ?? prompt).trim();
        if (!content || sending) return;
        if (!snapshot) { setError('请先打开一个画布项目。'); return; }
        if (workflow && !briefConfirmed) { setError('请先核对输入、要求及输出，确认本次需求。'); return; }
        if (workflow?.mask && !mask) {
            const node = selectedImages[0];
            if (selectedImages.length !== 1 || !node?.metadata?.content || !node.metadata.storageKey || ['loading', 'error'].includes(node.metadata.status || '') || (node.metadata.images?.length || 0) > 1) {
                setError('局部改型需要选择一张已保存的原图；图片组请先展开。'); return;
            }
            setError('');
            setMaskDraft({ projectId: snapshot.projectId, nodeId: node.id, dataUrl: node.metadata.content, prompt: content });
            return;
        }
        if (mask && (!workflow?.mask || !maskDraft || maskDraft.projectId !== snapshot.projectId || snapshot.nodes.find(node => node.id === maskDraft.nodeId)?.metadata?.content !== maskDraft.dataUrl)) {
            setError('原图已经变化，请关闭圈选窗口，重新选择原图。'); return;
        }
        const requestId = crypto.randomUUID();
        const request = workflow ? { id: workflowId, inputIds: mask && maskDraft ? [maskDraft.nodeId] : selectedImages.map(node => node!.id), requirements: content, count: workflow.series ? 10 : workflow.mode !== 'image' || workflow.mask ? 1 : count, materialsNote, identityRules, seriesPlan: seriesPlan.split('\n').map(value => value.trim()).filter(Boolean), briefConfirmed, ...(mask ? { maskDataUrl: mask.maskDataUrl } : {}) } : undefined;
        if (request) {
            try { planCanvasWorkflow(snapshot, request, requestId); }
            catch (cause) { setError(cause instanceof Error ? cause.message : '请检查输入图片与要求。'); return; }
        }
        setSending(true);
        setError('');
        const timeout = window.setTimeout(() => { setError('任务仍在等待回复。请查看原任务，勿重复提交同一生成要求。'); }, 60_000);
        const onMessage = (event: MessageEvent) => {
            const message = event.data;
            if (event.source !== window.parent || message?.source !== SOURCE || message.requestId !== requestId) return;
            if (message.type === 'session-created') { setLastSessionId(message.sessionId); return; }
            if (message.type !== 'session-result') return;
            cleanup.current?.();
            setSending(false);
            if (message.ok) {
                setPrompt("");
                setMaskDraft(null);
                setUpstreamRevision(undefined);
                setLastSessionId(message.sessionId || null);
            } else setError(message.error || '提交失败，请检查配置后重试。');
        };
        cleanup.current?.();
        cleanup.current = () => { window.clearTimeout(timeout); window.removeEventListener('message', onMessage); };
        window.addEventListener("message", onMessage);
        window.parent.postMessage({ source: SOURCE, type: "create-session", requestId, prompt: content, snapshot, sessionId: lastSessionId, ...(request ? { workflow: request, upstreamRevision } : {}) }, "*");
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ color: theme.node.text }}>
            <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3" style={{ borderColor: theme.node.stroke }}>
                <Bot size={18} />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Jonwork 画布会话</div>
                    <div className="text-xs opacity-60">AI 操作通过独立会话创建并回写画布</div>
                </div>
                <button
                    type="button"
                    onClick={onToggleMaximize}
                    className="flex h-9 items-center gap-2 rounded-lg bg-blue-500 px-3 text-xs font-semibold text-white shadow-[0_6px_18px_rgba(59,130,246,.3)] transition hover:bg-blue-600"
                    aria-label={maximized ? "还原画布会话窗口" : "最大化画布会话窗口"}
                    title={maximized ? "还原窗口" : "最大化窗口"}
                >
                    {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    {maximized ? "还原" : "最大化"}
                </button>
            </header>
            <div className="max-h-32 shrink-0 overflow-auto px-4 py-3 text-sm">
                <div className="rounded-xl border p-3 text-xs leading-5 opacity-75" style={{ borderColor: theme.node.stroke }}>
                    当前画布：{snapshot?.title || "正在读取"}<br />
                    节点：{snapshot?.nodes.length ?? 0} · 连线：{snapshot?.connections.length ?? 0} · 已选：{snapshot?.selectedNodeIds.length ?? 0}
                </div>
                {lastSessionId && <div className="mt-3 text-xs opacity-65">任务已提交：{lastSessionId.slice(0, 8)}</div>}
                {upstreamRevision && <div className="mt-3 text-xs">使用已批准成果 #{upstreamRevision}。请选择下一项业务并填写要求；报告内容会读取到新任务，图片组需先展开再选图。<button disabled={sending} className="ml-2 underline" onClick={() => setUpstreamRevision(undefined)}>取消上游关联</button></div>}
                {lastSessionId && <button className="mt-3 text-xs underline" onClick={() => window.parent.postMessage({ source: SOURCE, type: 'open-session', sessionId: lastSessionId }, '*')}>查看原任务与成果</button>}
                {error && <div role="alert" className="mt-3 rounded-lg border border-red-400 p-3 text-xs">{error}</div>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto border-t p-3" style={{ borderColor: theme.node.stroke }}>
                <label className="mb-2 block text-xs">业务操作
                    <select aria-label="业务操作" value={workflowId} disabled={sending || Boolean(maskDraft)} onChange={event => { setWorkflowId(event.target.value); setCount(1); setError(''); }} className="mt-1 w-full rounded-lg border p-2" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                        <option value="">自由会话 / 继续修改</option>
                        {CANVAS_WORKFLOWS.map(item => <option key={item.id} value={item.id}>{item.name} · {item.mode === 'text' ? '分析报告' : item.mode === 'model' ? 'GLB模型' : item.mask ? '圈选编辑' : '直接生成'}</option>)}
                    </select>
                </label>
                {workflow && <div className="mb-3 rounded-lg border p-2 text-xs leading-5" style={{ borderColor: theme.node.stroke }}>
                    <p>{workflow.inputs}</p>
                    <p>按选择顺序编号；请在画布中依次选择输入图片。原图会保留，结果另建节点。</p>
                    {selectedImages.map((node, index) => <div key={node!.id}>图{index + 1}：{node!.title || node!.id}</div>)}
                    {!selectedImages.length && <p>{workflow.min === 0 ? '图片可选；可以从文字材料开始。' : '尚未选择图片；先上传或选中画布中的图片。'}</p>}
                    {workflow.mode === 'image' && !workflow.mask && !workflow.series ? <label className="mt-2 flex items-center gap-2">输出数量
                        <select aria-label="输出数量" value={count} disabled={sending} onChange={event => setCount(Number(event.target.value))} className="rounded border px-2" style={{ background: theme.node.panel }}>
                            {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} 张</option>)}
                        </select>
                    </label> : <p>输出：{workflow.mode === 'text' ? '1份分析报告（Markdown）' : workflow.mode === 'model' ? '1个GLB模型 + 需求记录' : workflow.series ? '10款独立图片 + PI规范；将执行10次生成' : '1张局部改型结果'}</p>}
                    <p>{workflow.mode === 'text' ? '使用画布文本模型；选择图片时须支持视觉。不会自动搜索网页，来源须提供摘录。' : workflow.mode === 'model' ? '使用服务端Meshy配置；单图重建，不支持用文字修改几何。不可见面为推断，非工程CAD。' : workflow.mask ? '下一步涂抹修改区域；使用支持掩膜的图像编辑接口，不支持的模型会明确失败。' : '使用画布中配置的图像模型。'}结果待审查，不自动定稿。</p>
                    {workflow.research && <label className="block mt-2">材料与来源 / 资料缺口<textarea aria-label="材料与来源" className="w-full rounded border bg-transparent p-2" rows={3} maxLength={12000} disabled={sending} value={materialsNote} onChange={event => setMaterialsNote(event.target.value)} placeholder="粘贴访谈/竞品/上游报告摘录及来源，或说明目前无材料，仅形成待验证假设" /></label>}
                    {workflow.series && <><label className="block mt-2">共享PI规则<textarea aria-label="共享PI规则" className="w-full rounded border bg-transparent p-2" rows={2} maxLength={2000} disabled={sending} value={identityRules} onChange={event => setIdentityRules(event.target.value)} placeholder="共享轮廓、部件语言、CMF、标识位置；说明来自哪些种子" /></label><label className="block mt-2">10款品类 / 用途计划（每行一款）<textarea aria-label="10款品类计划" className="w-full rounded border bg-transparent p-2" rows={5} maxLength={3009} disabled={sending} value={seriesPlan} onChange={event => setSeriesPlan(event.target.value)} /></label></>}
                </div>}
                <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                    rows={5}
                    disabled={sending}
                    maxLength={4000}
                    placeholder={workflow?.mode === 'model' ? '说明模型用途和验收要求；这些要求用于审查，不作为文字改型指令' : workflow?.mode === 'text' ? '说明产品目标、目标用户、关注问题和评估标准；缺少的证据会列为待验证' : workflow ? '说明需要改变和必须保留的特征，例如：哑光白色，保留轮廓与把手比例' : '例如：创建一组品牌视觉方案，连接参考图与生成节点'}
                    className="w-full resize-none rounded-xl border bg-transparent p-3 text-sm outline-none"
                    style={{ borderColor: theme.node.stroke }}
                />
                {workflow && <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" aria-label="确认本次需求" checked={briefConfirmed} disabled={sending} onChange={event => setBriefConfirmed(event.target.checked)} />已核对输入顺序、材料、要求与输出数量，确认执行本次需求（可能产生模型费用）。</label>}
                <button
                    type="button"
                    onClick={() => submit()}
                    disabled={sending || !prompt.trim() || !snapshot}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-40"
                    style={{ background: theme.node.text, color: theme.node.panel }}
                >
                    {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                    {sending ? "正在提交任务" : workflow?.mask ? '下一步：圈选修改区域' : workflow ? `开始${workflow.name}` : lastSessionId ? "在原任务继续修改" : "创建画布会话"}
                </button>
            </div>
            {maskDraft && <CanvasNodeMaskEditDialog dataUrl={maskDraft.dataUrl} initialPrompt={maskDraft.prompt} open busy={sending} externalError={error} onClose={() => { if (!sending) { setMaskDraft(null); setError(''); } }} onConfirm={submit} />}
        </div>
    );
}
