/**
 * Organization storage — CONFIG_DIR/orgs.json
 *
 * Local single-device org bookkeeping. Invite tokens are opaque random strings.
 * Server-mode redemption (CRAFT_SERVER_URL) is handled at the RPC layer.
 */

import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes, randomUUID } from 'crypto'
import { CONFIG_DIR } from '../config/paths.ts'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import {
  ensureLocalUserIdentity,
  loadPreferences,
  type LocalUserIdentity,
} from '../config/preferences.ts'
import type {
  AcceptInviteInput,
  CreateOrganizationInput,
  InviteToOrgInput,
  OrgInvite,
  OrgInvitePublic,
  OrgMember,
  OrgRole,
  Organization,
  OrganizationWithMembers,
  OrgsStoreFile,
} from './types.ts'

const ORGS_FILE = join(CONFIG_DIR, 'orgs.json')
const STORE_VERSION = 1 as const

const EMPTY_STORE: OrgsStoreFile = {
  version: STORE_VERSION,
  organizations: [],
  members: [],
  invites: [],
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function newToken(): string {
  return randomBytes(24).toString('base64url')
}

function ensureDir(): void {
  const dir = dirname(ORGS_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function getOrgsPath(): string {
  return ORGS_FILE
}

export function loadOrgsStore(): OrgsStoreFile {
  if (!existsSync(ORGS_FILE)) {
    return { ...EMPTY_STORE, organizations: [], members: [], invites: [] }
  }
  // Fail closed: corrupt or unreadable existing file must not wipe data on next save.
  let raw: Partial<OrgsStoreFile> | null
  try {
    raw = readJsonFileSync<Partial<OrgsStoreFile>>(ORGS_FILE)
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error(`Failed to read orgs store: ${String(err)}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid orgs store: expected a JSON object')
  }
  return {
    version: STORE_VERSION,
    organizations: Array.isArray(raw.organizations) ? raw.organizations : [],
    members: Array.isArray(raw.members) ? raw.members : [],
    invites: Array.isArray(raw.invites) ? raw.invites : [],
  }
}

export function saveOrgsStore(store: OrgsStoreFile): void {
  ensureDir()
  const payload: OrgsStoreFile = {
    version: STORE_VERSION,
    organizations: store.organizations,
    members: store.members,
    invites: store.invites,
  }
  atomicWriteFileSync(ORGS_FILE, JSON.stringify(payload, null, 2) + '\n')
}

/** Strip invite tokens from list/get DTOs (create/accept still return full tokens). */
function toPublicInvite(invite: OrgInvite): OrgInvitePublic {
  const { token: _token, ...rest } = invite
  return rest
}

function uniqueSlug(base: string, existing: Organization[]): string {
  const root = slugify(base) || 'org'
  let slug = root
  let n = 2
  const taken = new Set(existing.map((o) => o.slug))
  while (taken.has(slug)) {
    slug = `${root}-${n}`
    n += 1
  }
  return slug
}

export function getLocalIdentity(): LocalUserIdentity {
  return ensureLocalUserIdentity()
}

/**
 * Resolve a membership without granting authority to a missing organization.
 * Callers that need to authorize a mutation should use one of the `require*`
 * variants below rather than treating a locally supplied orgId as proof.
 */
export function getOrganizationMembership(orgId: string, userId: string): OrgMember | null {
  const normalizedOrgId = typeof orgId === 'string' ? orgId.trim() : ''
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
  if (!normalizedOrgId || !normalizedUserId) return null

  const store = loadOrgsStore()
  if (!store.organizations.some((org) => org.id === normalizedOrgId)) return null
  return store.members.find(
    (member) => member.orgId === normalizedOrgId && member.userId === normalizedUserId,
  ) ?? null
}

/**
 * Server-side organization authority check for TeamSpace mutations.
 * A client-controlled orgId is never sufficient: the current principal must
 * be a durable member in the local server store.
 */
export function requireOrganizationMembership(orgId: string, userId: string): OrgMember {
  const normalizedOrgId = typeof orgId === 'string' ? orgId.trim() : ''
  if (!normalizedOrgId) throw new Error('orgId is required for a team workspace')

  const store = loadOrgsStore()
  if (!store.organizations.some((org) => org.id === normalizedOrgId)) {
    throw new Error(`Organization not found: ${normalizedOrgId}`)
  }

  const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
  const member = normalizedUserId
    ? store.members.find(
      (candidate) =>
        candidate.orgId === normalizedOrgId && candidate.userId === normalizedUserId,
    )
    : undefined
  if (!member) throw new Error('Not a member of this organization')
  return member
}

/** Require membership for the authenticated local server identity. */
export function requireCurrentLocalOrganizationMembership(orgId: string): OrgMember {
  return requireOrganizationMembership(orgId, ensureLocalUserIdentity().userId)
}

/** Fail closed for listing/selection paths when the org store is unavailable. */
export function isCurrentLocalOrganizationMember(orgId: string): boolean {
  try {
    return Boolean(requireCurrentLocalOrganizationMembership(orgId))
  } catch {
    return false
  }
}

export function listOrganizations(): OrganizationWithMembers[] {
  const store = loadOrgsStore()
  return store.organizations.map((org) => ({
    ...org,
    members: store.members.filter((m) => m.orgId === org.id),
    pendingInvites: store.invites
      .filter((i) => i.orgId === org.id && !i.acceptedAt)
      .map(toPublicInvite),
  }))
}

export function getOrganization(orgId: string): OrganizationWithMembers | null {
  const store = loadOrgsStore()
  const org = store.organizations.find((o) => o.id === orgId)
  if (!org) return null
  return {
    ...org,
    members: store.members.filter((m) => m.orgId === org.id),
    pendingInvites: store.invites
      .filter((i) => i.orgId === org.id && !i.acceptedAt)
      .map(toPublicInvite),
  }
}

export function listOrgMembers(orgId: string): OrgMember[] {
  const store = loadOrgsStore()
  if (!store.organizations.some((o) => o.id === orgId)) {
    throw new Error(`Organization not found: ${orgId}`)
  }
  return store.members.filter((m) => m.orgId === orgId)
}

export function createOrganization(input: CreateOrganizationInput): OrganizationWithMembers {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('Organization name is required')

  const identity = ensureLocalUserIdentity()
  const store = loadOrgsStore()
  const slug = uniqueSlug(input.slug?.trim() || name, store.organizations)
  const now = Date.now()
  const org: Organization = {
    id: `org_${randomUUID().slice(0, 12)}`,
    name,
    slug,
    createdBy: identity.userId,
    createdAt: now,
  }
  const owner: OrgMember = {
    orgId: org.id,
    userId: identity.userId,
    role: 'owner',
    displayLabel: identity.username || identity.email || identity.userId,
    joinedAt: now,
  }

  store.organizations.push(org)
  store.members.push(owner)
  saveOrgsStore(store)

  return {
    ...org,
    members: [owner],
    pendingInvites: [],
  }
}

function requireMemberRole(store: OrgsStoreFile, orgId: string, userId: string, min: OrgRole): OrgMember {
  const member = store.members.find((m) => m.orgId === orgId && m.userId === userId)
  if (!member) throw new Error('Not a member of this organization')
  const rank: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 }
  if (rank[member.role] < rank[min]) {
    throw new Error(`Requires ${min} role or higher`)
  }
  return member
}

export function inviteToOrganization(input: InviteToOrgInput): OrgInvite {
  const orgId = input.orgId
  const emailOrUsername = (input.emailOrUsername ?? '').trim()
  if (!orgId) throw new Error('orgId is required')
  if (!emailOrUsername) throw new Error('emailOrUsername is required')

  const role: Exclude<OrgRole, 'owner'> = input.role === 'admin' ? 'admin' : 'member'
  const identity = ensureLocalUserIdentity()
  const store = loadOrgsStore()
  if (!store.organizations.some((o) => o.id === orgId)) {
    throw new Error(`Organization not found: ${orgId}`)
  }
  requireMemberRole(store, orgId, identity.userId, 'admin')

  // Dedup pending invite for same target
  const existing = store.invites.find(
    (i) =>
      i.orgId === orgId &&
      !i.acceptedAt &&
      i.emailOrUsername.toLowerCase() === emailOrUsername.toLowerCase(),
  )
  if (existing) {
    existing.role = role
    saveOrgsStore(store)
    return existing
  }

  const invite: OrgInvite = {
    id: `inv_${randomUUID().slice(0, 12)}`,
    orgId,
    emailOrUsername,
    role,
    token: newToken(),
    createdAt: Date.now(),
    createdBy: identity.userId,
  }
  store.invites.push(invite)
  saveOrgsStore(store)
  return invite
}

/**
 * Accept an invite by token.
 * Local path: matches email/username against local profile when possible,
 * otherwise attaches to the current local userId.
 * When CRAFT_SERVER_URL is set, callers should prefer server redemption first.
 */
export function acceptInvite(input: AcceptInviteInput): {
  org: OrganizationWithMembers
  member: OrgMember
  invite: OrgInvite
} {
  const token = (input.token ?? '').trim()
  if (!token) throw new Error('token is required')

  const store = loadOrgsStore()
  const invite = store.invites.find((i) => i.token === token)
  if (!invite) throw new Error('Invite not found')
  if (invite.acceptedAt) throw new Error('Invite already accepted')

  const org = store.organizations.find((o) => o.id === invite.orgId)
  if (!org) throw new Error('Organization not found for invite')

  const identity = ensureLocalUserIdentity()
  const prefs = loadPreferences()
  const userId = (input.userId ?? identity.userId).trim()
  if (!userId) throw new Error('userId is required')

  // Soft match: if invite targets a specific email/username and local profile
  // has a different one, still allow on single-device (local-first). Record label.
  const label =
    prefs.email?.toLowerCase() === invite.emailOrUsername.toLowerCase()
      ? prefs.email
      : prefs.username?.toLowerCase() === invite.emailOrUsername.toLowerCase()
        ? prefs.username
        : invite.emailOrUsername

  let member = store.members.find((m) => m.orgId === invite.orgId && m.userId === userId)
  const now = Date.now()
  if (!member) {
    member = {
      orgId: invite.orgId,
      userId,
      role: invite.role,
      displayLabel: label,
      joinedAt: now,
    }
    store.members.push(member)
  } else {
    // Elevate role if invite is higher
    const rank: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 }
    if (rank[invite.role] > rank[member.role]) {
      member.role = invite.role
    }
    if (!member.displayLabel) member.displayLabel = label
  }

  invite.acceptedAt = now
  invite.acceptedByUserId = userId
  saveOrgsStore(store)

  return {
    org: {
      ...org,
      members: store.members.filter((m) => m.orgId === org.id),
      pendingInvites: store.invites
        .filter((i) => i.orgId === org.id && !i.acceptedAt)
        .map(toPublicInvite),
    },
    member,
    invite,
  }
}

export function updateMemberRole(orgId: string, userId: string, role: OrgRole): OrgMember {
  const identity = ensureLocalUserIdentity()
  const store = loadOrgsStore()
  requireMemberRole(store, orgId, identity.userId, 'owner')
  const member = store.members.find((m) => m.orgId === orgId && m.userId === userId)
  if (!member) throw new Error('Member not found')
  if (member.role === 'owner' && role !== 'owner') {
    const owners = store.members.filter((m) => m.orgId === orgId && m.role === 'owner')
    if (owners.length <= 1) throw new Error('Cannot demote the only owner')
  }
  member.role = role
  saveOrgsStore(store)
  return member
}

export function findInviteByToken(token: string): OrgInvite | null {
  const store = loadOrgsStore()
  return store.invites.find((i) => i.token === token) ?? null
}
