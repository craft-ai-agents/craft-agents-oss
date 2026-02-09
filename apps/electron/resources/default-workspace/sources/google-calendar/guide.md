# Google Calendar

Google Workspace MCP integration providing access to Google Calendar for viewing and managing events.

## Scope

This source connects to your Google Calendar account via the workspace-mcp server. It provides:
- **Calendar viewing**: Check upcoming events and availability
- **Event management**: Create, update, and delete calendar events
- **Scheduling assistance**: Find available time slots and manage meetings

## Guidelines

### Primary Use Cases
- **Check calendar**: View upcoming events and check availability
- **Create events**: Schedule meetings and appointments
- **Manage events**: Update or cancel existing calendar entries

### Best Practices
- The MCP server runs locally and connects to Google Calendar API
- OAuth authentication is handled automatically on first use
- Supports natural language event creation (e.g., "Schedule a meeting tomorrow at 2pm")
- Can query free/busy status to find available time slots

### Rate Limits
- Subject to Google Calendar API quotas
- Standard limits apply for event creation and queries
- Calendar read operations are generally unlimited for personal use

### Authentication
- Uses OAuth 2.0 with Client ID and Secret (pre-configured)
- First use will prompt for Google account authorization
- Credentials stored securely by the MCP server

## Common Operations

### View Upcoming Events
Ask to see your calendar or upcoming events for a specific date range.

### Create Events
Request to schedule meetings or create calendar events with details like:
- Event title and description
- Date and time
- Duration
- Attendees (optional)
- Location (optional)

### Check Availability
Query free/busy status to find available time slots for scheduling.

## Technical Details

- **Server**: workspace-mcp (Google Workspace MCP server)
- **Tool tier**: core (essential calendar operations)
- **Transport**: stdio (local subprocess)
- **Auth**: OAuth 2.0 via environment variables
