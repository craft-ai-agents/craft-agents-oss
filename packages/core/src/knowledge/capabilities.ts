/**
 * Provider capability discovery.
 * Verbatim K-03 §3.2 (docs/specs/2026-08-07-siyuan-integration/03-knowledge-provider-contract.md).
 */

export interface KnowledgeCapabilities {
  provider: string;               // 'siyuan'
  version: string;                // версия ядра, из health-check (compatibility.ts)
  minSupportedVersion: string;    // порог из packages/knowledge-siyuan/src/compatibility.ts
  features: {
    search: boolean;
    backlinks: boolean;
    attributes: boolean;
    databases: boolean;           // database/attribute views (att1 §4.3)
    assets: boolean;
    liveReference: boolean;       // поддержан режим getContext(ref, 'live-reference')
    watch: boolean;               // события изменений → knowledge:changed push
    deepLinks: boolean;           // стабильные deep links в нативный редактор
  };
  mutations: {
    createDocument: boolean;
    appendBlock: boolean;
    updateBlock: boolean;         // только explicitly selected block (att1 §11)
    setAttribute: boolean;        // только explicitly selected attribute
    transactions: boolean;        // мульти-оп атомарность; SiYuan: false → 1 op на proposal
    rollback: boolean;            // inversePatch сохраняется и применим
  };
}
