import { parseLabelEntry } from '@craft-agent/shared/labels'
import type { SessionMeta } from '@/atoms/sessions'

export const PROJECT_LABEL_ID = 'project'
export const GENERAL_PROJECT_KEY = 'project:__general__'
export const GENERAL_PROJECT_LABEL = 'General'

export interface SessionProjectInfo {
  key: string
  label: string
  value?: string
}

export function getSessionProjectInfo(session: Pick<SessionMeta, 'labels'>): SessionProjectInfo {
  const projectEntry = session.labels
    ?.map((entry) => parseLabelEntry(entry))
    .find((entry) => entry.id === PROJECT_LABEL_ID && typeof entry.rawValue === 'string' && entry.rawValue.trim().length > 0)

  const value = projectEntry?.rawValue?.trim()
  if (!value) return { key: GENERAL_PROJECT_KEY, label: GENERAL_PROJECT_LABEL }

  return {
    key: `project:${value.toLowerCase()}`,
    label: formatProjectLabel(value),
    value,
  }
}

export function formatProjectLabel(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 3 && /^[a-z0-9]+$/i.test(word)) return word.toUpperCase()
      if (/^[a-z0-9]+os$/i.test(word)) {
        const prefix = word.slice(0, -2)
        return prefix.charAt(0).toUpperCase() + prefix.slice(1) + 'OS'
      }
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export function slugifyProjectName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

export function setSessionProjectLabel(labels: string[], projectSlug?: string): string[] {
  const withoutProject = labels.filter((entry) => parseLabelEntry(entry).id !== PROJECT_LABEL_ID)
  const normalized = projectSlug?.trim()
  return normalized ? [...withoutProject, `${PROJECT_LABEL_ID}::${normalized}`] : withoutProject
}
