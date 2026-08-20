---
name: research-and-publish
description: "Прочитать узел знаний SiYuan, провести веб-рисёрч по его теме и предложить обновление документа (proposal + diff) либо опубликовать отчёт в /Research/Reports."
globs: []
alwaysAllow:
  - knowledge.search
  - knowledge.read
  - knowledge.get_backlinks
icon: research-publish.svg
requiredSources:
  - siyuan
---

# research-and-publish

## Вход (`input`)
Один аргумент — knowledge ref: `siyuan://blocks/<id>` или `siyuan://documents/<id>`
(грамматика `[knowledge:…]` mentions).
Получи контекст через `knowledge.read` в режиме `snapshot` (воспроизводимость);
backlinks — через `knowledge.get_backlinks` для карты смежных документов.

## Порядок работы
1. READ: `knowledge.read(ref, mode: "snapshot")` → зафиксируй `content_hash`.
2. RESEARCH: web.search / browser.navigate по теме узла; источники фиксируй списком.
3. SYNTHESIZE: сопоставь найденное с текущим содержимым; ничего не переписывай молча.
4. WRITE — один из двух исходов:
   a. Обновление существующего документа → `knowledge.propose_update`
      (patch против захваченного base hash; пользователь увидит Craft Diff и примет/отклонит);
   b. Новый отчёт → `knowledge.publish` в notebook `Research`, путь `/Research/Reports/<slug>`.

## Контракт выхода (`output`)
- type: siyuan_document; destination: `/Research/Reports` (для исхода 4b);
  либо `MutationProposal` (для исхода 4a).
- Provenance обязателен: source_session_id, source_blocks (все читанные siyuan:// refs),
  web-источники, модель (по Контуру 3, 06-publication-pipeline.md).

## Запреты
- Не вызывать `knowledge.create_document`/`propose_update` массово (по одному целевому узлу).
- Не записывать вне `/Research/Reports` без явного запроса пользователя.
- Bulk delete / SQL write / silent overwrite — запрещены на уровне контура записи.
- Write capabilities MUST NOT be listed in `alwaysAllow` — only read-only tools above.
