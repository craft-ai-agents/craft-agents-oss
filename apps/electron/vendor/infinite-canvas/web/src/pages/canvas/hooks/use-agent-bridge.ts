import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { flushSync } from 'react-dom';
import { executeJonworkDelivery } from '@/lib/canvas/jonwork-delivery';
import { getImageBlob, uploadImage } from '@/services/image-storage';
import { isManagedCanvas } from '@/lib/managed-canvas';
import type { DeliveryArtifact } from '@/lib/canvas/jonwork-delivery';

import i18n from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasSidePanelStore, type CanvasSidePanelTab } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: { maskDataUrl?: string }) => Promise<void>) | null>;

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Codex panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }), [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt, op.maskDataUrl ? { maskDataUrl: op.maskDataUrl } : undefined);
                    }),
                );
            }
            return { ...next, projectId, title: projectTitle };
        },
        [projectTitle, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: projectTitle };
    }, [agentUndoSnapshot, projectTitle, projectId]);

    useEffect(() => {
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, setAgentCanvasContext, undoAgentOps]);

    useEffect(() => {
        window.parent.postMessage({ source: "jonwork-infinite-canvas", type: "snapshot", snapshot: agentSnapshot }, "*");
    }, [agentSnapshot]);

    useEffect(() => {
        let active = true;
        const deliveries = new Set<string>();
        const onMessage = async (event: MessageEvent) => {
            const message = event.data;
            if (event.source !== window.parent || message?.source !== "jonwork-infinite-canvas") return;
            if (message.type === "open-side-panel" && ["canvas", "assets", "prompts"].includes(message.tab)) {
                useCanvasSidePanelStore.getState().openTab(message.tab as CanvasSidePanelTab);
                return;
            }
            if (message.type === "set-theme" && ["light", "dark"].includes(message.theme)) {
                useThemeStore.getState().setTheme(message.theme as ThemeName);
                return;
            }
            if (message.type === "open-project" && typeof message.projectId === "string") {
                window.location.hash = `#/canvas/${encodeURIComponent(message.projectId)}?jonwork=1`;
                return;
            }
            if (message.type !== "apply-ops" || !Array.isArray(message.ops)) return;
            if (message.projectId !== projectId || typeof message.requestId !== 'string' || deliveries.size) return;
            deliveries.add(message.requestId);
            const progress = (text: string) => window.parent.postMessage({ source: 'jonwork-infinite-canvas', type: 'ops-progress', requestId: message.requestId, revision: message.revision, projectId, progress: text }, '*');
            const heartbeat = window.setInterval(() => progress('正在执行并保存成果，请保持当前画布打开…'), 5000);
            try {
                const result = await executeJonworkDelivery({
                    projectId, ops: message.ops, apply: applyAgentOps,
                    snapshot: () => ({ projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current }),
                    active: () => active, progress,
                    model: image => new Promise((resolve, reject) => {
                        const id = crypto.randomUUID();
                        const finish = (event: MessageEvent) => {
                            const response = event.data;
                            if (event.source !== window.parent || response?.source !== 'jonwork-infinite-canvas' || response.type !== 'model-result' || response.modelRequestId !== id) return;
                            window.clearTimeout(timeout); window.removeEventListener('message', finish);
                            if (!active) reject(new Error('原画布已关闭，请回原任务继续获取3D结果。'));
                            else if (response.error) reject(new Error(response.error));
                            else resolve(response.artifact);
                        };
                        const timeout = window.setTimeout(() => { window.removeEventListener('message', finish); reject(new Error('3D等待超时；供应商任务不会重建，请稍后继续获取。')); }, 25 * 60_000);
                        window.addEventListener('message', finish);
                        window.parent.postMessage({ source: 'jonwork-infinite-canvas', type: 'model-generation', modelRequestId: id, requestId: message.requestId, revision: message.revision, projectId, image }, '*');
                    }),
                    flush: async () => { await new Promise(resolve => setTimeout(resolve, 0)); flushSync(() => {}); },
                    generate: async (id, mode, prompt, options) => {
                        if (isManagedCanvas) {
                            const config = message.ops.find((op: CanvasAgentOp) => op.type === 'add_node' && op.id === id);
                            const ids: string[] = config?.metadata?.businessBrief?.inputIds || [];
                            const images = await Promise.all(ids.map(async nodeId => {
                                const input = nodesRef.current.find(node => node.id === nodeId);
                                const blob = input?.metadata?.storageKey ? await getImageBlob(input.metadata.storageKey) : null;
                                if (!blob || blob.size > 6 * 1024 * 1024) throw new Error('业务输入图片缺失或超过6MB，请重新上传。');
                                const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
                                return { nodeId, mimeType: blob.type, base64: data.split(',')[1] };
                            }));
                            const providerRequestId = crypto.randomUUID();
                            const artifacts = await new Promise<DeliveryArtifact[]>((resolve, reject) => {
                                const finish = (event: MessageEvent) => {
                                    const response = event.data;
                                    if (event.source !== window.parent || response?.source !== 'jonwork-infinite-canvas' || response.type !== 'provider-result' || response.providerRequestId !== providerRequestId) return;
                                    window.clearTimeout(timeout); window.removeEventListener('message', finish);
                                    if (!active) reject(new Error('原画布已关闭，服务端结果需回原任务核对。'));
                                    else if (response.error) reject(new Error(response.error));
                                    else resolve(response.artifacts);
                                };
                                const timeout = window.setTimeout(() => { window.removeEventListener('message', finish); reject(new Error('服务端响应超时，请核对原任务；不要重复生成。')); }, 150_000);
                                window.addEventListener('message', finish);
                                window.parent.postMessage({ source: 'jonwork-infinite-canvas', type: 'provider-generation', providerRequestId, requestId: message.requestId, revision: message.revision, nodeId: id, images }, '*');
                            });
                            if (!Array.isArray(artifacts) || !artifacts.length) throw new Error('服务端没有返回成果。');
                            const source = nodesRef.current.find(node => node.id === id)!;
                            for (const [index, artifact] of artifacts.entries()) {
                                const resultId = `result-${crypto.randomUUID()}`;
                                let metadata: CanvasNodeData['metadata'];
                                if (mode === 'text') metadata = { content: artifact.text, status: 'success' };
                                else {
                                    const image = await uploadImage(`data:${artifact.mimeType};base64,${artifact.base64}`);
                                    metadata = { content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, mimeType: image.mimeType, status: 'success' };
                                }
                                applyAgentOps([{ type: 'add_node', id: resultId, nodeType: mode, title: `${source.title} ${index + 1}`, position: { x: source.position.x + source.width + 80, y: source.position.y + index * 360 }, metadata }, { type: 'connect_nodes', fromNodeId: id, toNodeId: resultId }]);
                            }
                            return;
                        }
                        if (!generateNodeRef.current) throw new Error('生成器尚未就绪，请稍后再试。');
                        await generateNodeRef.current(id, mode, prompt, options);
                    },
                    image: async key => {
                        const blob = await getImageBlob(key);
                        if (!blob || blob.size > 16 * 1024 * 1024) throw new Error('图片不存在或超过16 MiB，请在画布中导出并核对。');
                        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
                        return { mimeType: blob.type, base64: dataUrl.split(',')[1] };
                    },
                });
                window.parent.postMessage({ source: "jonwork-infinite-canvas", type: "ops-applied", requestId: message.requestId, revision: message.revision, ...result }, "*");
            } catch (error) {
                window.parent.postMessage({ source: "jonwork-infinite-canvas", type: "ops-failed", requestId: message.requestId, revision: message.revision, error: error instanceof Error ? error.message : String(error) }, "*");
            } finally { window.clearInterval(heartbeat); deliveries.delete(message.requestId); }
        };
        window.addEventListener("message", onMessage);
        window.parent.postMessage({ source: "jonwork-infinite-canvas", type: "ready", projectId }, "*");
        return () => { active = false; window.removeEventListener("message", onMessage); };
    }, [applyAgentOps, projectId]);

    return { applyAgentOps };
}
