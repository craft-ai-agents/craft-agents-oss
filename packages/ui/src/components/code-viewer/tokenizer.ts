/**
 * Lightweight regex-based syntax tokenizer.
 *
 * Provides fallback highlighting when Shiki grammar is unavailable or for
 * file types not covered by LANGUAGE_MAP.  Tokenizes one line at a time:
 * each token is a [start, end] range + a CSS class name.  Callers compose
 * the ranges into highlighted JSX (colored spans on a monospace line).
 */

// ---------------------------------------------------------------------------
// Language definitions — ordered regexes (first match wins)
// ---------------------------------------------------------------------------

interface TokenRule {
  /** CSS class applied to the matched span. */
  className: string
  /** Ordered patterns — earlier patterns win. */
  patterns: RegExp[]
}

interface LanguageDef {
  name: string
  extensions: string[]
  /** Multi-line comment delimiters (used to suppress tokenizing inside comments). */
  blockComment?: { open: string; close: string }
  rules: TokenRule[]
}

// ---- JavaScript / TypeScript -----------------------------------------------

const JS_KEYWORDS =
  /\b(?:abstract|as|async|await|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|package|private|protected|public|readonly|return|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/

const JS_STRING_DOUBLE = /"(?:[^"\\]|\\.)*"/
const JS_STRING_SINGLE = /'(?:[^'\\]|\\.)*'/
const JS_STRING_TEMPLATE = /`(?:[^`\\]|\\.)*`/
const JS_COMMENT_LINE = /\/\/.*$/
const JS_COMMENT_BLOCK = /\/\*[\s\S]*?\*\//
const JS_NUMBER = /\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/
const JS_BOOLEAN = /\b(?:true|false|null|undefined)\b/
const JS_FUNCTION_CALL = /\b([a-zA-Z_$][\w$]*)(?=\s*\()/
const JS_BUILTIN = /\b(?:console|Math|JSON|Promise|Array|Object|String|Number|Boolean|Date|RegExp|Map|Set|Error|Symbol|parseInt|parseFloat)\b/

// ---- Python -----------------------------------------------------------------

const PY_KEYWORD =
  /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None|self|cls)\b/
const PY_STRING_DOUBLE = /"(?:[^"\\]|\\.)*"/
const PY_STRING_SINGLE = /'(?:[^'\\]|\\.)*'/
const PY_STRING_TRIPLE = /'''[\s\S]*?'''|"""[\s\S]*?"""/
const PY_COMMENT = /#.*$/
const PY_NUMBER = /\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/
const PY_DECORATOR = /@\w+/
const PY_BUILTIN = /\b(?:print|len|range|int|str|float|list|dict|set|tuple|bool|type|isinstance|enumerate|zip|map|filter|open|input|sorted|reversed|super|Exception|ValueError|TypeError)\b/

// ---- JSON -------------------------------------------------------------------

const JSON_STRING = /"(?:[^"\\]|\\.)*"/
const JSON_NUMBER = /-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/
const JSON_BOOLEAN = /\b(?:true|false|null)\b/

// ---- HTML / XML -------------------------------------------------------------

const HTML_TAG = /<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?\/?>/g
const HTML_ATTR = /\b[a-zA-Z-]+(?=\s*=)/g
const HTML_ATTR_VALUE = /"[^"]*"|'[^']*'/g
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const HTML_ENTITY = /&[a-zA-Z]+;|&#\d+;/g

// ---- CSS / SCSS -------------------------------------------------------------

const CSS_SELECTOR = /[.#]?[a-zA-Z][\w-]*(?=\s*[{,])/g
const CSS_PROPERTY = /[a-zA-Z-]+(?=\s*:)/g
const CSS_VALUE_NUMBER = /\b\d+\.?\d*(?:px|em|rem|%|vh|vw|s|ms|deg)?\b/g
const CSS_HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g
const CSS_STRING = /"[^"]*"|'[^']*'/g

// ---- Shell / Bash -----------------------------------------------------------

const SH_COMMENT = /#.*$/
const SH_STRING_DOUBLE = /"(?:[^"\\]|\\.)*"/
const SH_STRING_SINGLE = /'(?:[^'\\]|\\.)*'/
const SH_VARIABLE = /\$\{?\w+\}?/
const SH_KEYWORD =
  /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|echo|export|local|source|alias|unset|cd|pwd|ls|rm|cp|mv|mkdir|chmod)\b/
const SH_OPTION = /--?[a-zA-Z][\w-]*/

// ---- C / C++ -----------------------------------------------------------

const CPP_COMMENT_BLOCK = /\/\*[\s\S]*?\*\//
const CPP_COMMENT_LINE = /\/\/.*$/
const CPP_STRING = /"(?:[^"\\]|\\.)*"/
const CPP_CHAR = /'(?:[^'\\]|\\.)*'/
const CPP_NUMBER = /\b0[xX][\da-fA-F]+|\b\d+\.?\d*(?:[eE][+-]?\d+)?[fLuU]*\b/
const CPP_PREPROCESSOR = /#[a-zA-Z_]\w*/
const CPP_KEYWORD =
  /\b(?:alignas|alignof|auto|break|case|catch|class|const|constexpr|consteval|constinit|continue|decltype|default|delete|do|else|enum|explicit|export|extern|final|for|friend|goto|if|inline|mutable|namespace|new|noexcept|nullptr|operator|private|protected|public|register|requires|return|sizeof|static|static_assert|struct|switch|template|this|thread_local|throw|try|typedef|typeid|typename|union|using|virtual|volatile|while)\b/
const CPP_TYPE =
  /\b(?:void|bool|char|char8_t|char16_t|char32_t|wchar_t|short|int|long|signed|unsigned|float|double|size_t|ssize_t|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|string|vector|map|set|unordered_map|unordered_set|array|deque|list|forward_list|pair|tuple|shared_ptr|unique_ptr|weak_ptr|optional|variant)\b/
const CPP_BOOLEAN = /\b(?:true|false|NULL|nullptr)\b/

// ---- Rust ----------------------------------------------------------

const RUST_COMMENT_BLOCK = /\/\*[\s\S]*?\*\//
const RUST_COMMENT_LINE = /(?:\/\/!|\/\/).*$/
const RUST_STRING = /b?"(?:[^"\\]|\\.)*"/
const RUST_CHAR = /b?'(?:[^'\\]|\\.)*'/
// Hash-delimited raw strings — `r#"..."#`, `r##"..."##`, etc. — permit
// embedded quote characters up to the matching closing-hash count.
// `#*` (zero-or-more) is required so the zero-hash `r"…"` form still
// matches the most common case; the `\1` backreference then closes
// against the captured run, including empty (zero-hash) bodies.
const RUST_RAW_STRING = /b?r(#*)"[\s\S]*?"\1/
const RUST_NUMBER =
  /\b0[xX][\da-fA-F]+\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?(?:f32|f64|i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize)?\b/
const RUST_ATTRIBUTE = /#!?\[[^\]]*\]/
const RUST_LIFETIME = /'[a-zA-Z_]\w*/
const RUST_KEYWORD =
  /\b(?:as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while)\b/
const RUST_TYPE =
  /\b(?:bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|HashMap|HashSet|BTreeMap|BTreeSet|Some|None|Ok|Err)\b/

// ---- Go ----------------------------------------------------------

const GO_COMMENT_BLOCK = /\/\*[\s\S]*?\*\//
const GO_COMMENT_LINE = /\/\/.*$/
const GO_STRING = /"(?:[^"\\]|\\.)*"/
const GO_RAW_STRING = /`[^`]*`/
const GO_NUMBER = /\b0[xX][\da-fA-F]+\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/
const GO_KEYWORD =
  /\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\b/
const GO_BOOLEAN = /\b(?:true|false|nil|iota)\b/
const GO_BUILTIN =
  /\b(?:make|len|cap|new|append|copy|delete|panic|recover|print|println|complex|real|imag|close|error|bool|byte|rune|string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr|float32|float64)\b/
const GO_FUNCTION = /\b[a-zA-Z_]\w*(?=\s*\()/

// ---- YAML ----------------------------------------------------------

const YAML_COMMENT = /#.*$/
const YAML_STRING_DOUBLE = /"(?:[^"\\]|\\.)*"/
const YAML_STRING_SINGLE = /'(?:[^'\\]|\\.)*'/
const YAML_NUMBER = /-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/
const YAML_BOOLEAN = /\b(?:true|false|yes|no|on|off)\b/
const YAML_NULL = /\b(?:null|~)\b/
const YAML_TIMESTAMP =
  /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/
const YAML_ANCHOR = /&[\w-]+/
const YAML_ALIAS = /\*[\w-]+/
const YAML_KEY = /\b[a-zA-Z_][\w-]*(?=:)/

// ---- Markdown ----------------------------------------------------------

const MD_HEADING = /^#{1,6}\s+\S.*/
const MD_BOLD = /\*\*[^*\n]+\*\*/
const MD_ITALIC = /\*[^*\n]+\*|_[^_\n]+_/
const MD_CODE_INLINE = /`[^`\n]+`/
const MD_LINK = /!?\[[^\]]*\]\([^)]*\)/

// ---------------------------------------------------------------------------
// Language registry
// ---------------------------------------------------------------------------

const LANGUAGES: Record<string, LanguageDef> = {
  typescript: {
    name: 'TypeScript',
    extensions: ['ts', 'tsx', 'mts', 'cts'],
    blockComment: { open: '/*', close: '*/' },
    rules: [
      { className: 'tk-comment', patterns: [JS_COMMENT_BLOCK, JS_COMMENT_LINE] },
      { className: 'tk-string', patterns: [JS_STRING_TEMPLATE, JS_STRING_DOUBLE, JS_STRING_SINGLE] },
      { className: 'tk-keyword', patterns: [JS_KEYWORDS] },
      { className: 'tk-builtin', patterns: [JS_BUILTIN] },
      { className: 'tk-boolean', patterns: [JS_BOOLEAN] },
      { className: 'tk-number', patterns: [JS_NUMBER] },
      { className: 'tk-function', patterns: [JS_FUNCTION_CALL] },
    ],
  },
  javascript: {
    name: 'JavaScript',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    blockComment: { open: '/*', close: '*/' },
    rules: [
      { className: 'tk-comment', patterns: [JS_COMMENT_BLOCK, JS_COMMENT_LINE] },
      { className: 'tk-string', patterns: [JS_STRING_TEMPLATE, JS_STRING_DOUBLE, JS_STRING_SINGLE] },
      { className: 'tk-keyword', patterns: [JS_KEYWORDS] },
      { className: 'tk-builtin', patterns: [JS_BUILTIN] },
      { className: 'tk-boolean', patterns: [JS_BOOLEAN] },
      { className: 'tk-number', patterns: [JS_NUMBER] },
      { className: 'tk-function', patterns: [JS_FUNCTION_CALL] },
    ],
  },
  python: {
    name: 'Python',
    extensions: ['py', 'pyi', 'pyx'],
    blockComment: undefined,
    rules: [
      { className: 'tk-string', patterns: [PY_STRING_TRIPLE, PY_STRING_DOUBLE, PY_STRING_SINGLE] },
      { className: 'tk-comment', patterns: [PY_COMMENT] },
      { className: 'tk-keyword', patterns: [PY_KEYWORD] },
      { className: 'tk-decorator', patterns: [PY_DECORATOR] },
      { className: 'tk-builtin', patterns: [PY_BUILTIN] },
      { className: 'tk-number', patterns: [PY_NUMBER] },
    ],
  },
  json: {
    name: 'JSON',
    extensions: ['json', 'jsonc', 'json5'],
    rules: [
      { className: 'tk-string', patterns: [JSON_STRING] },
      { className: 'tk-number', patterns: [JSON_NUMBER] },
      { className: 'tk-boolean', patterns: [JSON_BOOLEAN] },
    ],
  },
  html: {
    name: 'HTML',
    extensions: ['html', 'htm', 'xhtml'],
    blockComment: { open: '<!--', close: '-->' },
    rules: [
      { className: 'tk-comment', patterns: [HTML_COMMENT] },
      { className: 'tk-string', patterns: [HTML_ATTR_VALUE] },
      { className: 'tk-tag', patterns: [HTML_TAG] },
      { className: 'tk-entity', patterns: [HTML_ENTITY] },
    ],
  },
  css: {
    name: 'CSS',
    extensions: ['css', 'scss', 'less'],
    blockComment: { open: '/*', close: '*/' },
    rules: [
      { className: 'tk-comment', patterns: [CSS_COMMENT] },
      { className: 'tk-string', patterns: [CSS_STRING] },
      { className: 'tk-hexcolor', patterns: [CSS_HEX_COLOR] },
      { className: 'tk-number', patterns: [CSS_VALUE_NUMBER] },
      { className: 'tk-property', patterns: [CSS_PROPERTY] },
      { className: 'tk-selector', patterns: [CSS_SELECTOR] },
    ],
  },
  shell: {
    name: 'Shell',
    extensions: ['sh', 'bash', 'zsh', 'fish', 'ksh'],
    rules: [
      { className: 'tk-comment', patterns: [SH_COMMENT] },
      { className: 'tk-string', patterns: [SH_STRING_DOUBLE, SH_STRING_SINGLE] },
      { className: 'tk-variable', patterns: [SH_VARIABLE] },
      { className: 'tk-keyword', patterns: [SH_KEYWORD] },
      { className: 'tk-option', patterns: [SH_OPTION] },
    ],
  },
  cpp: {
    name: 'C/C++',
    extensions: ['c', 'h', 'cpp', 'cxx', 'cc', 'hpp', 'hxx', 'hh', 'm', 'mm', 'inc', 'inl', 'ipp', 'tcc', 'tpp'],
    blockComment: { open: '/*', close: '*/' },
    rules: [
      { className: 'tk-comment', patterns: [CPP_COMMENT_BLOCK, CPP_COMMENT_LINE] },
      { className: 'tk-string', patterns: [CPP_STRING, CPP_CHAR] },
      { className: 'tk-keyword', patterns: [CPP_PREPROCESSOR, CPP_KEYWORD] },
      { className: 'tk-builtin', patterns: [CPP_TYPE] },
      { className: 'tk-boolean', patterns: [CPP_BOOLEAN] },
      { className: 'tk-number', patterns: [CPP_NUMBER] },
    ],
  },
  rust: {
    name: 'Rust',
    extensions: ['rs'],
    blockComment: { open: '/*', close: '*/' },
    rules: [
      { className: 'tk-comment', patterns: [RUST_COMMENT_BLOCK, RUST_COMMENT_LINE] },
      { className: 'tk-string', patterns: [RUST_STRING, RUST_CHAR, RUST_RAW_STRING] },
      { className: 'tk-decorator', patterns: [RUST_ATTRIBUTE] },
      { className: 'tk-tag', patterns: [RUST_LIFETIME] },
      { className: 'tk-keyword', patterns: [RUST_KEYWORD] },
      { className: 'tk-builtin', patterns: [RUST_TYPE] },
      { className: 'tk-number', patterns: [RUST_NUMBER] },
    ],
  },
  go: {
    name: 'Go',
    extensions: ['go'],
    blockComment: { open: '/*', close: '*/' },
    rules: [
      { className: 'tk-comment', patterns: [GO_COMMENT_BLOCK, GO_COMMENT_LINE] },
      { className: 'tk-string', patterns: [GO_STRING, GO_RAW_STRING] },
      { className: 'tk-keyword', patterns: [GO_KEYWORD] },
      { className: 'tk-boolean', patterns: [GO_BOOLEAN] },
      { className: 'tk-builtin', patterns: [GO_BUILTIN] },
      { className: 'tk-number', patterns: [GO_NUMBER] },
      { className: 'tk-function', patterns: [GO_FUNCTION] },
    ],
  },
  yaml: {
    name: 'YAML',
    extensions: ['yaml', 'yml'],
    rules: [
      { className: 'tk-comment', patterns: [YAML_COMMENT] },
      { className: 'tk-string', patterns: [YAML_STRING_DOUBLE, YAML_STRING_SINGLE] },
      { className: 'tk-boolean', patterns: [YAML_BOOLEAN, YAML_NULL] },
      { className: 'tk-number', patterns: [YAML_NUMBER, YAML_TIMESTAMP] },
      { className: 'tk-keyword', patterns: [YAML_ANCHOR, YAML_ALIAS, YAML_KEY] },
    ],
  },
  markdown: {
    name: 'Markdown',
    extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'],
    rules: [
      // Inline code + links match BEFORE the heading span so that
      // `# Heading with `code text`` doesn't lose its code tint to a
      // whole-line heading match. First-match-wins + position-ordered
      // spans prevent the heading regex from swallowing trailing
      // backtick code when both fire on the same line.
      { className: 'tk-string', patterns: [MD_CODE_INLINE, MD_LINK] },
      { className: 'tk-keyword', patterns: [MD_HEADING, MD_BOLD, MD_ITALIC] },
    ],
  },
}

/** One annotated span: [start, end) in the source line + CSS class. */
export interface TokenSpan {
  start: number
  end: number
  className: string
}

/** Tokenise one line of source code into non-overlapping spans. */
export function tokenizeLine(line: string, lang: string): TokenSpan[] {
  const def = LANGUAGES[lang]
  if (!def) return []

  const spans: TokenSpan[] = []

  for (const rule of def.rules) {
    for (const pattern of rule.patterns) {
      // Reset lastIndex for global regexes
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        spans.push({ start: m.index, end: m.index + m[0].length, className: rule.className })
        // Prevent infinite loop on zero-length matches
        if (m[0].length === 0) re.lastIndex++
      }
    }
  }

  // Sort by start position, then by length (longer matches first at same start)
  spans.sort((a, b) => a.start - b.start || b.end - a.end)

  // Remove overlapping spans (first wins due to rule ordering above)
  const filtered: TokenSpan[] = []
  let covered = 0
  for (const span of spans) {
    if (span.start < covered) continue
    filtered.push(span)
    covered = Math.max(covered, span.end)
  }

  return filtered
}

/** Map a file extension to a language id understood by tokenizeLine. */
export function detectCodeLanguage(extension: string): string {
  const ext = extension.toLowerCase()
  for (const [id, def] of Object.entries(LANGUAGES)) {
    if (def.extensions.includes(ext)) return id
  }
  return ''
}

/** Map a file path to a language id. */
export function detectCodeLanguageFromPath(filePath: string): string {
  const ext = (filePath.split('.').pop() ?? '').toLowerCase()
  return detectCodeLanguage(ext)
}
