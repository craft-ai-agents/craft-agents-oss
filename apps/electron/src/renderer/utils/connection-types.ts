/**
 * Connection Type Utilities
 *
 * Centralized configuration for connection types (gmail, mcp, api, etc.)
 * Makes it easy to add new connection types without updating multiple files.
 */

import { Mail, Plug, Globe, type LucideIcon } from 'lucide-react'
import type { ConnectionConfig } from '../../shared/types'

interface ConnectionTypeConfig {
  /** Display label for the connection type */
  label: string
  /** Fixed logo URL, or null to derive from mcpUrl/apiUrl */
  logoUrl: string | null
  /** Fallback icon when logo fails to load */
  FallbackIcon: LucideIcon
}

/**
 * Configuration map for all connection types.
 * Add new types here to automatically support them across the UI.
 */
export const CONNECTION_TYPE_CONFIG: Record<string, ConnectionTypeConfig> = {
  gmail: {
    label: 'Gmail',
    logoUrl: 'https://mail.google.com',
    FallbackIcon: Mail,
  },
  mcp: {
    label: 'MCP Server',
    logoUrl: null,
    FallbackIcon: Plug,
  },
  api: {
    label: 'API',
    logoUrl: null,
    FallbackIcon: Globe,
  },
}

/**
 * Get the logo URL for a connection.
 * Returns the type-specific URL if configured, otherwise falls back to mcpUrl/apiUrl.
 */
export function getConnectionLogoUrl(conn: ConnectionConfig): string {
  const config = CONNECTION_TYPE_CONFIG[conn.type]
  if (config?.logoUrl) {
    return config.logoUrl
  }
  return conn.mcpUrl || conn.apiUrl || ''
}

/**
 * Get the display label for a connection type.
 */
export function getConnectionLabel(type: string): string {
  return CONNECTION_TYPE_CONFIG[type]?.label ?? 'Connection'
}

/**
 * Get the fallback icon component for a connection type.
 */
export function getConnectionFallbackIcon(type: string): LucideIcon {
  return CONNECTION_TYPE_CONFIG[type]?.FallbackIcon ?? Plug
}
