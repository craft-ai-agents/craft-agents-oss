export const MAX_VISIBLE_SESSION_LABELS = 1

export function compactSessionLabels<T>(labels: T[], maximum = MAX_VISIBLE_SESSION_LABELS) {
  const visible = labels.slice(0, Math.max(0, maximum))
  return { visible, hidden: labels.slice(visible.length) }
}
