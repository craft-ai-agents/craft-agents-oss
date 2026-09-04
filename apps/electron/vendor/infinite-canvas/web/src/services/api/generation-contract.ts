/** Reject unsupported requests instead of silently dropping business-critical inputs. */
export function assertMaskSupport(format: string, scripted: boolean, referenceCount: number, count: number) {
    if (scripted) throw new Error('当前自定义图像插件未接入掩膜，不能执行局部改型。请切换到支持掩膜的图像编辑接口。');
    if (format === 'gemini') throw new Error('当前 Gemini 图像接口不支持掩膜，不能执行局部改型。请切换到支持掩膜的图像编辑接口。');
    if (referenceCount !== 1 || count !== 1) throw new Error('局部改型必须提供一张原图，并且每次只生成一张结果。');
}

export function requireTextResult(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error('模型未返回文本成果，请检查模型是否支持图片分析，调整配置后重试。');
    return value.trim();
}

export function validateMaskPixels(width: number, height: number, sourceWidth: number, sourceHeight: number, rgba: Uint8ClampedArray) {
    if (!width || !height || width !== sourceWidth || height !== sourceHeight || width * height > 16_777_216 || rgba.length !== width * height * 4) throw new Error('圈选区域与原图尺寸不一致或图片过大，请重新圈选。');
    let editable = false, protectedArea = false;
    for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] === 0) editable = true;
        if (rgba[i] === 255) protectedArea = true;
    }
    if (!editable) throw new Error('尚未圈选修改区域，请先涂抹要修改的部分。');
    if (!protectedArea) throw new Error('局部改型必须保留未圈选区域；如需修改整张图片，请使用整图编辑。');
}
