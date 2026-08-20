/**
 * Organization / team workspace types (P3.1).
 *
 * Local-first bookkeeping under CONFIG_DIR/orgs.json. When CRAFT_SERVER_URL
 * is set, invite redemption prefers the server path; pure local multi-user
 * stores pending invites redeemed on this device.
 */

export type OrgRole = 'owner' | 'admin' | 'member'

export interface Organization {
  id: string
  name: string
  slug: string
  createdBy: string
  createdAt: number
}

export interface OrgMember {
  orgId: string
  userId: string
  role: OrgRole
  /** Display hint only — may be email or username at invite time */
  displayLabel?: string
  joinedAt: number
}

export interface OrgInvite {
  id: string
  orgId: string
  /** Email or username the invite targets */
  emailOrUsername: string
  role: Exclude<OrgRole, 'owner'>
  token: string
  createdAt: number
  createdBy: string
  acceptedAt?: number
  acceptedByUserId?: string
}

/** List/get DTO invite — token is never exposed outside create/accept. */
export type OrgInvitePublic = Omit<OrgInvite, 'token'> & { token?: never }

export interface OrgsStoreFile {
  version: 1
  organizations: Organization[]
  members: OrgMember[]
  invites: OrgInvite[]
}

export interface CreateOrganizationInput {
  name: string
  slug?: string
}

export interface InviteToOrgInput {
  orgId: string
  emailOrUsername: string
  role?: Exclude<OrgRole, 'owner'>
}

export interface AcceptInviteInput {
  token: string
  /** Optional override; defaults to local profile identity */
  userId?: string
}

export interface OrganizationWithMembers extends Organization {
  members: OrgMember[]
  /** Pending invites without redeem tokens (use create/accept for tokens). */
  pendingInvites: OrgInvitePublic[]
}
