/**
 * McpAppWidgetStack - Renders MCP Apps widgets below a TurnCard
 *
 * Filters activities for MCP Apps widget metadata, extracts widget data,
 * and renders a vertical stack of McpAppWidget components.
 */

import { useMemo } from 'react'
import type { ActivityItem } from '../chat/TurnCard'
import { McpAppWidget } from './McpAppWidget'
import { extractMcpAppWidget, deriveServerId, type McpAppWidgetData } from './mcp-app-utils'

export interface McpAppWidgetStackProps {
  activities: ActivityItem[]
  // Pass through for tool/resource calls
  onCallTool?: (serverId: string, name: string, args: Record<string, unknown>) => Promise<unknown>
  onReadResource?: (serverId: string, uri: string) => Promise<unknown>
  onListResources?: (serverId: string) => Promise<{ resources: unknown[] }>
  onSendFollowUp?: (text: string) => void
}

export function McpAppWidgetStack({
  activities,
  onCallTool,
  onReadResource,
  onListResources,
  onSendFollowUp,
}: McpAppWidgetStackProps) {
  // Extract MCP Apps widgets from activities
  const widgets = useMemo(() => {
    const result: (McpAppWidgetData & { serverId: string })[] = []
    for (const activity of activities) {
      const widget = extractMcpAppWidget(activity)
      if (widget) {
        result.push({
          ...widget,
          serverId: deriveServerId(activity),
        })
      }
    }
    return result
  }, [activities])

  if (widgets.length === 0) return null

  return (
    <div className="space-y-2 mt-2">
      {widgets.map((widget) => (
        <McpAppWidget
          key={widget.activity.id}
          html={widget.html}
          name={widget.name}
          serverId={widget.serverId}
          csp={widget.csp}
          props={widget.props}
          dev={widget.dev}
          toolInput={widget.toolInput}
          toolOutput={widget.toolOutput}
          onCallTool={onCallTool
            ? (name, args) => onCallTool(widget.serverId, name, args)
            : undefined
          }
          onReadResource={onReadResource
            ? (uri) => onReadResource(widget.serverId, uri)
            : undefined
          }
          onListResources={onListResources
            ? () => onListResources(widget.serverId)
            : undefined
          }
          onSendFollowUp={onSendFollowUp}
        />
      ))}
    </div>
  )
}
