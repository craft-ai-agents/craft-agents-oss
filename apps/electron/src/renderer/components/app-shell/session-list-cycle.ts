export function getCycledSessionIndex(
  rowCount: number,
  currentIndex: number,
  direction: -1 | 1,
): number | null {
  if (rowCount === 0) return null
  const nextIndex = currentIndex === -1
    ? (direction === 1 ? 0 : rowCount - 1)
    : (currentIndex + direction + rowCount) % rowCount
  return nextIndex === currentIndex ? null : nextIndex
}
