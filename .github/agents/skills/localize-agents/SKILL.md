---
name: "Localize Agents"
description: "Translate i18n keys for craft-agents: add missing translations, update changed texts, or add a new language. Uses Craft's glossary and per-language tone rules."
alwaysAllow: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"]
---

# Localize Agents

Localization skill for the craft-agents repo. Detects missing/changed translations and generates them using Craft's glossary and tone rules.

---

## Paths

- **Locale files**: `packages/shared/src/i18n/locales/{lang}.json`
- **Registry (single source of truth)**: `packages/shared/src/i18n/registry.ts`
- **Derived exports**: `packages/shared/src/i18n/languages.ts` (auto-derived from registry)
- **i18n setup**: `packages/shared/src/i18n/setupI18n.ts`
- **i18n index**: `packages/shared/src/i18n/index.ts`
- **Tests**: `packages/shared/src/i18n/__tests__/locale-parity.test.ts`, `locale-registry.test.ts`
- **Glossary**: `../craft-localization/glossary.json` (relative to repo root)
- **Guidelines**: `packages/shared/CLAUDE.md` → i18n section

## Supported Languages

Read dynamically from `packages/shared/src/i18n/registry.ts`. Currently: `en`, `es`, `zh-Hans`, `ja`, `hu`, `de`, `pl`.
Available for addition: `fr`, `it`, `ko`, `pt-BR`, `vi`, `zh-Hant`.

## Token Optimization

1. Never read full locale JSON files into context — use Python scripts to extract diffs.
2. Batch translation calls per language (all missing keys in one call_llm).
3. Use temp files to pass data between steps.

---

## Skill Modes

At the start, ask the user:

```
Which mode?
  1. Translate new    — detect keys in en.json missing from other locales, translate them
  2. Update changed   — re-translate keys whose English text was modified
  3. Add language     — add a new supported language to the app
```

---

## MODE 1: Translate New Keys

### Step 1: Detect Missing Keys

```bash
python3 -c "
import json, glob, os

ROOT = 'packages/shared/src/i18n/locales'
en = json.load(open(f'{ROOT}/en.json'))

for f in sorted(glob.glob(f'{ROOT}/*.json')):
    lang = os.path.basename(f).replace('.json', '')
    if lang == 'en': continue
    other = json.load(open(f))
    missing = sorted(set(en.keys()) - set(other.keys()))
    if missing:
        print(f'{lang}: {len(missing)} missing keys')
        for k in missing[:10]:
            print(f'  {k}: \"{en[k]}\"')
        if len(missing) > 10:
            print(f'  ... and {len(missing) - 10} more')
        # Write missing keys to temp file
        missing_data = {k: en[k] for k in missing}
        json.dump(missing_data, open(f'/tmp/i18n-missing-{lang}.json', 'w'), indent=2, ensure_ascii=False)
    else:
        print(f'{lang}: up to date ✓')
"
```

If no missing keys → exit with "All translations up to date ✓".

### Step 2: Read Glossary

```bash
python3 -c "
import json, os
ROOT = os.path.dirname(os.popen('git rev-parse --show-toplevel').read().strip())
glossary_path = f'{ROOT}/craft-localization/glossary.json'
if os.path.exists(glossary_path):
    g = json.load(open(glossary_path))
    print('Non-translatable:', g.get('nonTranslatable', []))
    json.dump(g, open('/tmp/i18n-glossary.json', 'w'), indent=2, ensure_ascii=False)
else:
    print('Glossary not found — using built-in non-translatable list')
    # Fallback for when craft-localization is not cloned
    g = {'nonTranslatable': ['Apple', 'Craft', 'Craft Agents', 'Agents', 'Workspace', 'Skill', 'MCP', 'API', 'SDK', 'Claude', 'Anthropic', 'OpenAI', 'GitHub Copilot', 'ChatGPT', 'Ollama', 'OpenRouter', 'Codex', 'Mermaid', 'Git', 'OAuth', 'WebSocket']}
    json.dump(g, open('/tmp/i18n-glossary.json', 'w'), indent=2, ensure_ascii=False)
"
```

### Step 3: Extract Style References

Pull 3 short existing translations from each target locale for tone consistency:

```bash
python3 -c "
import json, random, glob, os

ROOT = 'packages/shared/src/i18n/locales'
en = json.load(open(f'{ROOT}/en.json'))
short_keys = [k for k, v in en.items() if 5 < len(v) < 40 and '{{' not in v]
random.seed(42)
sample = random.sample(short_keys, min(5, len(short_keys)))

for f in sorted(glob.glob(f'{ROOT}/*.json')):
    lang = os.path.basename(f).replace('.json', '')
    if lang == 'en': continue
    other = json.load(open(f))
    refs = {k: {'en': en[k], lang: other.get(k, '')} for k in sample if k in other}
    json.dump(refs, open(f'/tmp/i18n-refs-{lang}.json', 'w'), indent=2, ensure_ascii=False)
"
```

### Step 4: Translate via Parallel call_llm

Fire one `call_llm` per language — all in parallel. Each prompt:

```
You are translating UI strings for Craft Agents, a premium desktop app for AI agent sessions.
Craft's brand voice is warm, friendly, and personal.

## Strings to Translate to [LANGUAGE]

[JSON object with missing keys and English values]

## Glossary
Non-translatable: [from glossary.json]
Preferred translations for [LANGUAGE]: [from glossary.json preferredTranslations]

## Style Reference
[3-5 existing translations for tone matching]

## Tone Rules for [LANGUAGE]
[Per-language rules from this skill — see section below]

## Length Constraints
- Permission mode badges: 3-5 characters max
- Settings tab labels: ≤10 characters
- Button labels: ≤2x English length
- Menu items: ≤3x English length
- Keep {{placeholders}} exactly as-is
- Keep brand names in English

Return ONLY a JSON object with the same keys and translated values.
```

### Step 5: Verify Translations

Run on every translation:
1. **Placeholder check**: every `{{...}}` from English must appear in translation
2. **Glossary check**: non-translatable terms must be unchanged
3. **Empty check**: no translation can be empty
4. **Length check**: flag translations >100% longer than English on short strings (<20ch)

If any fail → show issues, let user fix or retry that language.

### Step 6: Write Translations

```bash
python3 -c "
import json, glob, os

ROOT = 'packages/shared/src/i18n/locales'
for f in sorted(glob.glob(f'{ROOT}/*.json')):
    lang = os.path.basename(f).replace('.json', '')
    if lang == 'en': continue
    translated_path = f'/tmp/i18n-translated-{lang}.json'
    if not os.path.exists(translated_path): continue
    existing = json.load(open(f))
    new_keys = json.load(open(translated_path))
    existing.update(new_keys)
    sorted_data = dict(sorted(existing.items()))
    with open(f, 'w') as fh:
        json.dump(sorted_data, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'{lang}.json: {len(sorted_data)} keys (added {len(new_keys)})')

# Verify parity
en = json.load(open(f'{ROOT}/en.json'))
for f in sorted(glob.glob(f'{ROOT}/*.json')):
    lang = os.path.basename(f).replace('.json', '')
    if lang == 'en': continue
    other = json.load(open(f))
    missing = set(en.keys()) - set(other.keys())
    if missing:
        print(f'WARNING: {lang} still missing {len(missing)} keys!')
    else:
        print(f'{lang}: parity verified ✓')
"
```

---

## MODE 2: Update Changed Translations

### Step 1: Identify Changed Keys

```bash
python3 -c "
import json, subprocess

# Get diff of en.json against HEAD
diff = subprocess.run(['git', 'diff', 'HEAD', 'packages/shared/src/i18n/locales/en.json'], capture_output=True, text=True).stdout

# Parse changed keys from diff
changed = {}
en = json.load(open('packages/shared/src/i18n/locales/en.json'))
# Look for lines like: -  \"key\": \"old value\" / +  \"key\": \"new value\"
import re
removed = {}
added = {}
for line in diff.split('\n'):
    m = re.match(r'^-\s+\"([^\"]+)\":\s+\"(.+)\"', line)
    if m: removed[m.group(1)] = m.group(2).rstrip(',')
    m = re.match(r'^\+\s+\"([^\"]+)\":\s+\"(.+)\"', line)
    if m: added[m.group(1)] = m.group(2).rstrip(',')

# Keys that exist in both removed and added = changed values
for k in removed:
    if k in added and removed[k] != added[k]:
        changed[k] = {'old': removed[k], 'new': added[k]}

if not changed:
    print('No changed English values detected.')
else:
    print(f'Found {len(changed)} changed keys:')
    for k, v in changed.items():
        print(f'  {k}:')
        print(f'    Old: \"{v[\"old\"]}\"')
        print(f'    New: \"{v[\"new\"]}\"')
    json.dump(changed, open('/tmp/i18n-changed.json', 'w'), indent=2, ensure_ascii=False)
"
```

If user provides specific keys instead, use those directly.

### Step 2: Show Current Translations

For each changed key, extract current translations from all locales (don't read full files).

### Step 3: Re-translate via Parallel call_llm

Same approach as Mode 1, but with additional context:
- Include the OLD translation as reference
- Add: "The English text changed from 'X' to 'Y'. Update the translation accordingly."
- Let the LLM decide: minimal tweak or full rewrite

### Step 4: Verify + Review

Show old vs new translations side-by-side. User can edit individual translations.

### Step 5: Write

REPLACE values in each locale JSON (not append). Sort alphabetically. Verify parity.

---

## MODE 3: Add New Language

### Step 1: Ask Which Language

Show available languages (not yet in the registry):
```
Available languages:
  fr  — Français (French)
  it  — Italiano (Italian)
  ko  — 한국어 (Korean)
  pt-BR — Português (Brazilian Portuguese)
  vi  — Tiếng Việt (Vietnamese)
  zh-Hant — 繁體中文 (Traditional Chinese)

Already supported: en, es, zh-Hans, ja, hu, de, pl

Which language to add?
```

### Step 2: Create Locale File

Create `packages/shared/src/i18n/locales/{lang}.json` with empty object `{}`.

### Step 3: Register Language in Registry

The registry (`packages/shared/src/i18n/registry.ts`) is the **single source of truth**. Everything else (language codes, display names, i18n resources, date locales) is derived automatically. Only this file needs to change.

**3a. Update `registry.ts`:**
```typescript
// Add translation import
import frMessages from "./locales/fr.json";

// Add date-fns locale import
import { fr as frDateLocale } from "date-fns/locale/fr";

// Add entry to LOCALE_REGISTRY
fr: { nativeName: "Français", messages: frMessages, dateLocale: frDateLocale },
```

**3b. Add date locale test** in `packages/shared/src/i18n/__tests__/locale-registry.test.ts`:
```typescript
it("fr resolves to French", () => {
  const locale = getDateLocale("fr");
  expect(locale.code).toBe("fr");
});
```

No changes needed to `languages.ts`, `setupI18n.ts`, or `CLAUDE.md` — they derive from the registry automatically.

**3c. For languages with complex plurals** (e.g., Polish, Arabic, Russian): add `_few` and `_many` forms for all plural keys. The parity test allows extra plural forms when the base `_one`/`_other` pair exists in EN.

### Step 4: Translate ALL Keys

Same as Mode 1 Steps 2-6, but for ALL keys (not just missing ones). Split into batches of ~60 keys per call_llm to stay within token limits.

### Step 5: Length Audit

```bash
python3 -c "
import json
en = json.load(open('packages/shared/src/i18n/locales/en.json'))
lang = 'de'  # the new language
other = json.load(open(f'packages/shared/src/i18n/locales/{lang}.json'))

risks = []
for k in en:
    if k not in other: continue
    en_len, other_len = len(en[k]), len(other[k])
    if en_len < 20 and other_len > en_len * 2:
        growth = (other_len - en_len) / max(en_len, 1) * 100
        risks.append((k, en[k], other[k], growth))

risks.sort(key=lambda x: -x[3])
if risks:
    print(f'⚠️  {len(risks)} translations significantly longer than English:')
    for k, en_v, other_v, growth in risks[:15]:
        print(f'  +{growth:.0f}% {k}: \"{en_v}\" → \"{other_v}\"')
else:
    print('All translations within acceptable length ✓')
"
```

Suggest shorter alternatives for any flagged items.

### Step 6: Summary

```
✅ Language added: Deutsch (de)
   - Locale file: packages/shared/src/i18n/locales/de.json (972 keys)
   - languages.ts: updated
   - setupI18n.ts: updated
   - CLAUDE.md: updated

   Test: Switch to Deutsch in Settings > Appearance > Language
```

---

## Glossary

The glossary is loaded from `craft-localization/glossary.json` when available. Fallback built-in list:

**Non-translatable** (always keep in English):
Apple, Craft, Craft Agents, Agents, Workspace, MCP, API, SDK, Claude, Anthropic, OpenAI, GitHub Copilot, ChatGPT, Evernote, TeX, TextBundle, Unsplash, Imagine, Plus, Markdown, Ollama, OpenRouter, Codex, Mermaid, Playwright, Puppeteer, React, Git, WebSocket, OAuth

**Additional non-translatable for craft-agents:**
Workspace (product term — never translate in any language), Skill (keep as loanword, not native equivalent)

---

## Per-Language Tone Rules

**Universal rules (all languages):**
- Preserve `{{placeholders}}` exactly
- Match English brevity — UI labels should be concise
- Short button/action labels should be noun-form or infinitive (not full sentences)
- Keep brand terms in English: Workspace, Space, Block, Craft, Craft Agents
- Permission mode badges: keep under 5 characters
- Settings tab labels: keep under 10 characters

---

### German (de) — Formal (Sie)
- **Address**: Sie/Ihr/Ihre. Consistent formal register throughout.
- **Buttons**: Noun form — "Löschen" (not "Lösche"), "Hinzufügen" (not "Füge hinzu")
- **Confirmations**: "Möchten Sie wirklich...?" pattern
- **Reference vocabulary** (Apple standard): Löschen, Abbrechen, Fertig, Speichern, Teilen, Suchen, Kopieren, Hinzufügen, Entfernen, Öffnen, Schließen, Umbenennen, Einstellungen
- **Note**: Keep established English tech terms (Workspace, Space, Block, Markdown). Declension: "Ihren Agenten" (not "Ihren Agent").

### Spanish (es) — Informal (tú)
- **Address**: tú/tu/tus forms. NEVER usted. NEVER vosotros (Latin American neutral).
- **Buttons**: Infinitive form — "Eliminar", "Añadir"/"Agregar", "Compartir"
- **Confirmations**: "¿Quieres...?" or "¿Estás seguro de...?" pattern
- **Reference vocabulary** (Apple standard): Eliminar, Cancelar, Guardar, Compartir, Buscar, Copiar, Renombrar, Exportar, Importar, Negrita, Cursiva, Título, Tabla, Enlace, Etiquetas
- **Note**: Both "Añadir" and "Agregar" are acceptable for "Add"

### French (fr) — Formal (vous)
- **Address**: vous/votre/vos. NEVER tu/ton/ta. 100% formal like Apple.
- **Buttons**: Infinitive form — "Supprimer", "Ajouter", "Partager"
- **Confirmations**: "Voulez-vous vraiment...?" pattern
- **Reference vocabulary** (Apple standard): Supprimer, Annuler, Terminé, Enregistrer/Sauvegarder, Partager, Rechercher, Copier, Coller, Renommer, Exporter, Importer, Gras, Italique, Titre, Tableau, Lien
- **Note**: "Impossible de..." for "Cannot..." errors. Professional-friendly tone.

### Hungarian (hu) — Informal (te), verbal nouns for labels
- **Address**: te/tied/neked when addressing user. NEVER Ön/Önnek.
- **Buttons**: Verbal noun (-ás/-és) form — "Törlés" (not "Töröld"), "Mentés", "Megosztás", "Hozzáadás", "Keresés", "Másolás", "Exportálás", "Importálás"
- **Confirmations**: "Biztosan...?" pattern
- **Reference vocabulary** (Apple standard): Törlés, Mégsem, Kész, Mentés, Megosztás, Keresés, Másolás, Beillesztés, Átnevezés, Hozzáadás, Eltávolítás, Megnyitás, Bezárás, Beállítások, Félkövér, Dőlt, Cím, Címsor, Táblázat, Link, Címkék
- **Note**: Most concise of all languages. "Nem sikerült..." for errors. Use definite articles (a/az) where grammatically required.

### Italian (it) — Tu-form imperatives for buttons
- **Address**: Prefer impersonal or infinitive. Tu form OK for direct address. NEVER Lei/Suo/Sua.
- **Buttons**: 2nd person imperative (Apple standard) — "Elimina", "Aggiungi", "Condividi", "Cerca", "Copia", "Incolla", "Apri", "Chiudi". NOT infinitive for buttons.
- **Confirmations**: "Vuoi davvero...?" or "Confermi di voler...?" pattern
- **Reference vocabulary** (Apple standard): Elimina, Annulla, Fine, Salva, Condividi, Cerca, Copia, Incolla, Rinomina, Aggiungi, Rimuovi, Apri, Chiudi, Esporta, Importa, Grassetto, Corsivo, Titolo, Intestazione, Tabella, Link, Impostazioni
- **Note**: "Impossibile..." for "Cannot..." errors.

### Japanese (ja) — Context-dependent formality
- **Short labels**: Plain/dictionary form — 削除, 追加, 保存, 共有, 検索, コピー, 編集, 設定
- **Descriptions/messages**: Polite -ます form — "削除しました", "保存されます"
- **Instructions/requests**: -てください form — "入力してください", "確認してください"
- **Confirmations**: "...しますか?" or "...してもよろしいですか?" pattern
- **Katakana**: Use for established loanwords (コピー, ペースト, キャンセル, リンク, タグ, フォルダ, フィルター, ボールド, イタリック, タイトル). Use native words when standard (削除 not デリート, 検索 not サーチ).
- **Reference vocabulary** (Apple standard): 削除, キャンセル, 完了, 保存, 共有, 検索, コピー, 追加, 閉じる, 開く, 設定, ボールド, イタリック, タイトル, 見出し, 本文, 表, リンク, タグ
- **Note**: No spaces between words. Avoid excessive katakana when a kanji term is standard.

### Korean (ko) — Formal speech levels
- **Short labels**: Bare noun form — 삭제, 추가, 저장, 공유, 검색, 복사, 편집, 설정
- **Statements/descriptions**: -ㅂ니다/-습니다 (formal) — "삭제됩니다", "저장합니다"
- **Instructions to user**: -세요 (polite) — "선택하세요", "입력하세요"
- **System messages/warnings**: -십시오 (formal request) — "확인하십시오"
- **Confirmations**: "-겠습니까?" pattern — "삭제하겠습니까?"
- **Reference vocabulary** (Apple standard): 삭제, 취소, 완료, 저장, 공유, 검색, 복사, 붙여넣기, 이름 변경, 추가, 닫기, 열기, 내보내기, 가져오기, 설정, 볼드체, 이탤릭체, 제목, 머리말, 본문, 표, 링크, 태그
- **Note**: Use spaces between words. "할 수 없습니다" for "Cannot..." errors.

### Polish (pl) — Informal (ty)
- **Address**: ty/twój/twoja. Capitalize "Twoje" mid-sentence (Polish polite-informal convention). NEVER Pan/Pani.
- **Buttons**: 2nd person imperative — "Usuń", "Dodaj", "Zamknij", "Otwórz", "Kopiuj", "Wklej", "Eksportuj", "Importuj"
- **Confirmations**: "Czy na pewno chcesz...?" pattern
- **Reference vocabulary** (Apple standard): Usuń, Anuluj, Gotowe, Zapisz/Zachowaj, Udostępnij, Szukaj, Kopiuj, Wklej, Zmień nazwę, Dodaj, Zamknij, Otwórz, Eksportuj, Importuj, Ustawienia, Pogrubienie, Kursywa, Tytuł, Nagłówek, Tabela, Tagi
- **Plural forms**: Polish requires `_one`, `_few`, `_many`, and `_other` categories. Example: 1 etykieta (_one), 2 etykiety (_few), 5 etykiet (_many). All plural keys must have all four forms.
- **Note**: "Nie można..." for "Cannot..." errors. Use "API" (not "APIs") as the uninflected acronym.

### Portuguese BR (pt-BR) — Informal (você)
- **Address**: você/seu/sua. NEVER senhor/senhora. Casual-friendly tone.
- **Buttons**: Infinitive form — "Adicionar", "Compartilhar", "Exportar", "Importar", "Salvar"
- **Confirmations**: "Tem certeza de que deseja...?" or "Você quer...?" pattern
- **Capitalize** nouns in button labels: "Adicionar Coluna", "Nova Pasta"
- **Reference vocabulary** (Apple standard): Apagar/Excluir, Cancelar, Salvar, Compartilhar, Buscar, Copiar, Colar, Renomear, Adicionar, Remover, Fechar, Abrir, Exportar, Importar, Negrito, Itálico, Título, Tabela, Link, Etiquetas
- **Note**: Both "Apagar" and "Excluir" acceptable for "Delete". "Não é possível..." for errors.

### Vietnamese (vi) — Neutral "bạn"
- **Address**: "bạn" as standard pronoun. Rarely use "vui lòng" (only for important requests). Use "hãy" as soft imperative marker.
- **Buttons**: Short verb form — "Xóa", "Thêm", "Lưu", "Chia sẻ", "Tìm kiếm", "Sao chép", "Dán", "Mở", "Đóng"
- **Confirmations**: "Bạn có chắc chắn muốn...không?" pattern
- **Reference vocabulary** (Apple standard): Xóa, Hủy, Xong, Lưu, Chia sẻ, Tìm kiếm, Sao chép, Dán, Đổi tên, Thêm, Đóng, Mở, Xuất, Nhập, Cài đặt, Đậm, Nghiêng, Tiêu đề, Nội dung, Bảng, Liên kết, Thẻ
- **Note**: "Không thể..." for "Cannot..." errors. Diacritics are critical — never omit them.

### Chinese Simplified (zh-Hans) — Concise, impersonal
- **Address**: Avoid direct pronouns where possible. Use impersonal constructions. When pronoun needed, use 你 (informal). Do NOT use 您 (nín).
- **Buttons**: Shortest possible — 删除, 添加, 保存, 共享, 搜索, 复制, 粘贴, 导出, 导入
- **Punctuation**: Full-width (。，！？) for sentences, half-width for UI labels
- **Confirmations**: "确定要...吗？" pattern
- **Reference vocabulary** (Apple standard): 删除, 取消, 完成, 保存, 共享, 搜索, 复制, 粘贴, 添加, 移除, 关闭, 打开, 导出, 导入, 设置, 粗体, 斜体, 标题, 正文, 表格, 链接, 标签
- **Note**: "无法..." for "Cannot..." errors. Extremely concise — shorter than English when possible. Uses Simplified characters (简体).

### Chinese Traditional (zh-Hant) — Taiwan vocabulary, concise
- **Address**: Same as Simplified — avoid pronouns, use 你 when needed. Do NOT use 您.
- **Buttons**: Shortest possible but **different vocabulary from Simplified** — 刪除, 加入 (NOT 添加), 儲存 (NOT 保存), 分享 (NOT 共享), 搜尋 (NOT 搜索)
- **Punctuation**: Full-width (。，！？) for sentences
- **Confirmations**: "確定要...嗎？" pattern
- **Reference vocabulary** (Apple standard): 刪除, 取消, 完成, 儲存, 分享, 搜尋, 拷貝, 貼上, 加入, 移除, 關閉, 打開, 輸出 (NOT 導出), 輸入 (NOT 導入), 設定, 粗體, 斜體, 大標題, 標題, 內文, 表格, 連結, 標籤
- **Critical vocab differences from zh-Hans**: 添加→加入, 保存→儲存, 共享→分享, 搜索→搜尋, 导出→輸出, 导入→輸入, 文件→檔案, 账户→帳號, 复制→拷貝, 链接→連結
- **Note**: "無法..." for errors. Uses Traditional characters (繁體) with Taiwan-standard vocabulary (NOT Hong Kong).
