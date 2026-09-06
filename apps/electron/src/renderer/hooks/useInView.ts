import * as React from 'react'

/**
 * Observe whether an element has entered the viewport. Used to lazily fetch
 * page-tile posters so a large grid doesn't request every thumbnail at once.
 *
 * `triggerOnce` (default) latches true on first intersection and stops
 * observing — posters, once loaded, should stay loaded rather than churn as the
 * user scrolls.
 */
export function useInView<T extends Element>(
  options?: { rootMargin?: string; triggerOnce?: boolean },
): [React.RefObject<T>, boolean] {
  // useRef<T>(null) → RefObject<T> (readonly current: T | null), which the DOM
  // `ref` prop accepts; useRef<T | null> widens T and breaks that assignment.
  const ref = React.useRef<T>(null)
  const [inView, setInView] = React.useState(false)
  const triggerOnce = options?.triggerOnce ?? true
  const rootMargin = options?.rootMargin ?? '200px'

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    // No IntersectionObserver (very old webviews / test env) → assume visible.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            if (triggerOnce) observer.disconnect()
          } else if (!triggerOnce) {
            setInView(false)
          }
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin, triggerOnce])

  return [ref, inView]
}
