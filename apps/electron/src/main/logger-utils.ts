export function formatLogData(data: unknown[]): string {
  return data
    .map((entry) => {
      if (entry instanceof Error) {
        return entry.stack || entry.message || String(entry)
      }
      if (entry && typeof entry === 'object') {
        return JSON.stringify(entry)
      }
      return String(entry)
    })
    .join(' ')
}
