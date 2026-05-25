export interface ParsedTablePreview {
  delimiter: ',' | '\t'
  rows: string[][]
  truncated: boolean
}

const MAX_TABLE_PREVIEW_ROWS = 200
const MAX_TABLE_PREVIEW_COLUMNS = 40

export function parseDelimitedTablePreview(content: string, path?: string, mimeType?: string): ParsedTablePreview {
  const delimiter = inferDelimiter(path, mimeType, content)
  const rows = parseDelimitedRows(content, delimiter)
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => row.slice(0, MAX_TABLE_PREVIEW_COLUMNS))
  return {
    delimiter,
    rows: rows.slice(0, MAX_TABLE_PREVIEW_ROWS),
    truncated: rows.length > MAX_TABLE_PREVIEW_ROWS,
  }
}

function inferDelimiter(path: string | undefined, mimeType: string | undefined, content: string): ',' | '\t' {
  const lowerPath = path?.toLowerCase() ?? ''
  if (lowerPath.endsWith('.tsv') || mimeType === 'text/tab-separated-values') return '\t'
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ','
}

function parseDelimitedRows(content: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]
    const next = content[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell)
      cell = ''
      continue
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  rows.push(row)
  return rows
}
