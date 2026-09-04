import { javascript } from "@codemirror/lang-javascript";
import CodeMirror from "@uiw/react-codemirror";
import { Button, Modal } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getPluginReturn, getPluginTemplates, getPluginVariables } from "@/services/api/model-plugin";
import type { ModelCapability } from "@/stores/use-config-store";

function isDarkMode() {
    return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function ModelScriptEditor({ open, capability, modelName, value, onSave, onClose }: { open: boolean; capability: ModelCapability; modelName: string; value: string; onSave: (script: string) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(value);
    useEffect(() => {
        if (open) setDraft(value);
    }, [open, value]);

    const variables = getPluginVariables().filter((variable) => !variable.capabilities || variable.capabilities.includes(capability));
    const templates = getPluginTemplates()[capability];

    return (
        <Modal
            open={open}
            title={
                <div>
                    <div className="text-base font-semibold">
                        {t(`config.channelEditor.capabilities.${capability}`)}
                        {modelName ? ` - ${modelName}` : ""}
                    </div>
                    <div className="mt-1 text-xs font-normal text-stone-500">{t("config.scriptEditor.description")}</div>
                </div>
            }
            width={1080}
            centered
            onCancel={onClose}
            styles={{ body: { padding: 0 } }}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        {templates.map((template) => (
                            <Button key={template.label} size="small" onClick={() => setDraft(template.script)}>
                                {t("config.scriptEditor.insertTemplate", { name: template.label })}
                            </Button>
                        ))}
                        <Button size="small" danger onClick={() => setDraft("")}>
                            {t("config.scriptEditor.restoreDefault")}
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose}>{t("common.cancel")}</Button>
                        <Button
                            type="primary"
                            onClick={() => {
                                onSave(draft.trim());
                                onClose();
                            }}
                        >
                            {t("common.save")}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="flex h-[60vh] min-h-[420px] border-t border-stone-200 dark:border-stone-800">
                <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-r border-stone-200 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-900/40">
                    <div className="border-b border-stone-200/70 px-4 py-3 dark:border-stone-800/70">
                        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{t("config.scriptEditor.returnRequirements")}</div>
                        <div className="text-xs leading-6 text-stone-600 dark:text-stone-300">{getPluginReturn(capability)}</div>
                    </div>
                    <div className="px-4 py-3">
                        <div className="mb-2.5 flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{t("config.scriptEditor.variables")}</span>
                            <span className="text-[10px] text-stone-400">{t("config.scriptEditor.insert")}</span>
                        </div>
                        <div className="space-y-1.5">
                            {variables.map((variable) => (
                                <button
                                    key={variable.name}
                                    type="button"
                                    onClick={() => setDraft((current) => (current ? `${current}\n${variable.name}` : variable.name))}
                                    className="group block w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-stone-200 hover:bg-white dark:hover:border-stone-700 dark:hover:bg-stone-800/60"
                                >
                                    <div className="flex flex-wrap items-baseline gap-1.5">
                                        <code className="rounded bg-stone-200/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-stone-800 group-hover:bg-blue-100 group-hover:text-blue-700 dark:bg-stone-800 dark:text-stone-100 dark:group-hover:bg-blue-950 dark:group-hover:text-blue-300">
                                            {variable.name}
                                        </code>
                                        <span className="font-mono text-[10px] text-stone-400">{variable.type}</span>
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{variable.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                </aside>
                <div className="min-w-0 flex-1 overflow-hidden bg-white dark:bg-stone-950">
                    <CodeMirror
                        value={draft}
                        onChange={setDraft}
                        height="100%"
                        theme={isDarkMode() ? "dark" : "light"}
                        extensions={[javascript()]}
                        placeholder={t("config.scriptEditor.placeholder")}
                        style={{ height: "100%", fontSize: 13 }}
                        className="h-full [&_.cm-editor]:h-full [&_.cm-gutters]:border-none [&_.cm-scroller]:overflow-auto"
                    />
                </div>
            </div>
        </Modal>
    );
}
