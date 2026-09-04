import type { CanvasAgentOp, CanvasAgentSnapshot } from './canvas-agent-ops';
import { validateCanvasMask } from '../../../../../../../../packages/session-tools-core/src/canvas-workflows';

export type DeliveryArtifact = { mimeType: string; base64?: string; text?: string };
type DeliveryOptions = {
    projectId: string;
    ops: CanvasAgentOp[];
    apply: (ops: CanvasAgentOp[]) => unknown;
    snapshot: () => CanvasAgentSnapshot;
    generate: (id: string, mode: 'image' | 'text', prompt: string, options?: { maskDataUrl?: string }) => Promise<void>;
    flush: () => Promise<void>;
    image: (key: string) => Promise<DeliveryArtifact>;
    model?: (image: DeliveryArtifact) => Promise<DeliveryArtifact>;
    progress: (text: string) => void;
    active: () => boolean;
};

/** The transport receipt is not a generation result. Only return after actual outputs exist. */
export async function executeJonworkDelivery(options: DeliveryOptions) {
    const { projectId, ops, snapshot } = options;
    const assertActive = () => {
        if (!options.active() || snapshot().projectId !== projectId) throw new Error('画布项目已切换或关闭，执行结果需要核对。');
    };
    assertActive();
    const generations = ops.filter((op): op is Extract<CanvasAgentOp, { type: 'run_generation' }> => op.type === 'run_generation');
    if (generations.some(op => op.mode && !['image', 'text'].includes(op.mode))) throw new Error('会话成果回写目前支持图片与文本；视频和音频请在画布中直接生成。');
    if (generations.some(op => op.expectedOutputCount !== undefined && (!Number.isInteger(op.expectedOutputCount) || op.expectedOutputCount < 1 || op.expectedOutputCount > 20))) throw new Error('无效的预期成果数量。');
    for (const op of generations) if (op.maskDataUrl !== undefined) {
        validateCanvasMask(op.maskDataUrl);
        if (op.mode !== 'image' || op.expectedOutputCount !== 1) throw new Error('局部改型必须为单张图像编辑。');
    }
    const artifacts: DeliveryArtifact[] = [];
    const nodeIds = new Set<string>();
    let index = 0;
    for (const op of ops) {
        assertActive();
        if (op.type === 'run_model_generation') {
            const source = snapshot().nodes.find(node => node.id === op.nodeId);
            if (!options.model || source?.type !== 'image' || !source.metadata?.storageKey) throw new Error('3D生成器或输入图片不可用。');
            options.progress('正在创建或继续获取3D任务，请保持画布打开…');
            artifacts.push(await options.model(await options.image(source.metadata.storageKey)));
            assertActive();
            continue;
        }
        if (op.type !== 'run_generation') { options.apply([op]); await options.flush(); continue; }
        const before = snapshot();
        const source = before.nodes.find(node => node.id === op.nodeId);
        if (!source) throw new Error('生成目标节点不存在，请刷新画布后重试。');
        const mode = op.mode || source.metadata?.generationMode || 'image';
        if (mode !== 'image' && mode !== 'text') throw new Error('此生成模式尚未接入会话成果回写。');
        const prompt = (op.prompt || source.metadata?.composerContent || source.metadata?.prompt || '').trim();
        if (!prompt) throw new Error('生成要求为空，请先填写提示词。');
        const beforeKeys = new Set(before.nodes.flatMap(node => [node.metadata?.storageKey, ...(node.metadata?.images || []).map(image => image.storageKey)]).filter(Boolean));
        options.progress(`正在生成 ${index + 1}/${generations.length}，请保持当前画布打开…`);
        await options.generate(op.nodeId, mode, prompt, op.maskDataUrl ? { maskDataUrl: op.maskDataUrl } : undefined);
        await options.flush();
        assertActive();
        const after = snapshot();
        const affected = new Set([op.nodeId]);
        // Only the source and newly-created downstream outputs belong to this run.
        const oldIds = new Set(before.nodes.map(node => node.id));
        for (let pass = 0; pass < after.nodes.length; pass++) {
            let changed = false;
            for (const edge of after.connections) if (affected.has(edge.fromNodeId) && !oldIds.has(edge.toNodeId) && !affected.has(edge.toNodeId)) { affected.add(edge.toNodeId); changed = true; }
            if (!changed) break;
        }
        const nodes = after.nodes.filter(node => affected.has(node.id));
        if (nodes.some(node => node.metadata?.status === 'error' || node.metadata?.images?.some(image => image.status !== 'success'))) {
            throw new Error('生成失败、已取消或部分图片未成功。成功图片保留在画布，请检查后发起修正任务。');
        }
        if (mode === 'image') {
            const keys = [...new Set(nodes.filter(node => node.type === 'image' && node.metadata?.status === 'success')
                .flatMap(node => node.metadata?.images?.length ? node.metadata.images.map(image => image.storageKey) : [node.metadata?.storageKey])
                .filter((key): key is string => !!key && !beforeKeys.has(key)))];
            if (!keys.length) throw new Error('没有生成新的图片。请检查画布的模型配置、输入图片和错误提示。');
            if (op.expectedOutputCount !== undefined && keys.length !== op.expectedOutputCount) throw new Error(`要求${op.expectedOutputCount}张图片，实际成功${keys.length}张。结果保留在画布，请核对后补齐，不会标记为已完成。`);
            for (const key of keys) artifacts.push(await options.image(key));
            for (const node of nodes) if (node.type === 'image' && (keys.includes(node.metadata?.storageKey || '') || node.metadata?.images?.some(image => keys.includes(image.storageKey)))) nodeIds.add(node.id);
        } else {
            const texts = nodes.filter(node => node.type === 'text' && (node.id !== source.id || source.type === 'text') && node.metadata?.status === 'success'
                && node.metadata.content?.trim() && node.metadata.content !== before.nodes.find(old => old.id === node.id)?.metadata?.content);
            if (!texts.length) throw new Error('没有生成新的文本成果，请检查模型配置和任务状态。');
            if (op.expectedOutputCount !== undefined && texts.length !== op.expectedOutputCount) throw new Error(`要求${op.expectedOutputCount}份报告，实际成功${texts.length}份。请核对后补齐，不会标记为已完成。`);
            artifacts.push(...texts.map(node => ({ mimeType: 'text/markdown', text: node.metadata!.content! })));
            texts.forEach(node => nodeIds.add(node.id));
        }
        if (artifacts.length > 20) throw new Error('单次成果超过20项，请分批生成。');
        index++;
    }
    assertActive();
    return { snapshot: snapshot(), artifacts, nodeIds: [...nodeIds] };
}
