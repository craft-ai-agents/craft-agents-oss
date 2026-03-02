import type { Annotation } from './MarkdownAnnotationContext'

const store = new Map<string, Annotation[]>()

export function getStoredAnnotations(planId: string): Annotation[] {
  return store.get(planId) ?? []
}

export function setStoredAnnotations(planId: string, annotations: Annotation[]): void {
  if (annotations.length === 0) {
    store.delete(planId)
  } else {
    store.set(planId, annotations)
  }
}

export function clearStoredAnnotations(planId: string): void {
  store.delete(planId)
}
