// Fixed by the parent at iframe creation, never inherited from legacy storage.
export const managedCanvasScope = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('managed') || '';
export const isManagedCanvas = Boolean(managedCanvasScope);
export function assertLocalCanvasGeneration() {
    if (isManagedCanvas) throw new Error('企业画布请使用14业务流程面板提交；模型与计费由服务器管理。');
}
