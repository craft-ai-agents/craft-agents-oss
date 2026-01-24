# Cron Scheduler

## Overview

The Cron Scheduler lets you automate recurring agent tasks like morning briefings, daily summaries, or periodic reports. Create schedules using simple presets or custom cron expressions, and Vespr will run your prompts automatically at the specified times.

**Key Features:**
- Visual preset cards for common schedules (hourly, daily, weekly, monthly)
- Custom cron expressions with visual builder
- One-time scheduled tasks
- Session continuation across schedule runs
- Native macOS notifications on completion
- Real-time UI updates across all windows

**Important:** Schedules only run when Vespr is open. A status indicator shows when schedules are active.

## Creating Schedules

### From the Scheduler UI

1. Navigate to the Scheduler section in the sidebar
2. Click "New Schedule" button
3. Fill out the schedule form:
   - **Name**: A descriptive name for your schedule (e.g., "Morning Standup")
   - **Prompt**: The message to send to the agent (e.g., "Summarize my calendar for today and list my priorities")
   - **When to run**: Choose between recurring or one-time

### From Chat (Natural Language)

You can create schedules directly from any chat session using natural language:

```
schedule this to run every weekday at 9am
```

Vespr will:
1. Detect the scheduling intent
2. Parse the time expression into a cron schedule
3. Create the schedule using the conversation context
4. Show a confirmation toast

Supported patterns:
- "schedule this to run [time expression]"
- "run this [time expression]"
- "remind me [time expression]"

## Schedule Options

### Preset Schedules

Choose from visual preset cards that show the schedule pattern and next run time:

| Preset | Schedule | Cron Expression |
|--------|----------|-----------------|
| Every hour | Runs at the top of each hour | `0 * * * *` |
| Daily at 9am | Runs every day at 9:00 AM | `0 9 * * *` |
| Weekdays at 9am | Monday-Friday at 9:00 AM | `0 9 * * 1-5` |
| Weekly on Monday | Every Monday at 9:00 AM | `0 9 * * 1` |
| Monthly on 1st | First day of each month at 9:00 AM | `0 9 1 * *` |

### Custom Cron Expressions

For advanced scheduling needs, select "Custom..." to create your own schedule:

1. **Visual Cron Builder**: Use the visual interface to build complex schedules
   - Select specific days of the week
   - Choose days of the month
   - Set custom times with the time picker

2. **Manual Cron Entry**: Enter a cron expression directly
   - Real-time validation shows if the expression is valid
   - Human-readable translation appears below (e.g., "Every weekday at 9:00 AM")
   - Preview of the next 3 run times

**Cron Format:**
```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-6, 0=Sunday)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

**Examples:**
- `0 9 * * 1-5` - Weekdays at 9:00 AM
- `*/30 9-17 * * *` - Every 30 minutes between 9 AM and 5 PM
- `0 0 1,15 * *` - 1st and 15th of each month at midnight

### One-Time Schedules

For tasks that should run once at a specific time:

1. Select "One-time" in the schedule modal
2. Choose the date and time using the datetime picker
3. The schedule will run once and automatically disable

## Session Continuation

Schedules maintain conversation context across executions by reusing the same session:

**How It Works:**
- First execution creates a new session named "Schedule: [name]"
- Subsequent executions continue in the same session
- The agent has access to all previous outputs and context
- Full conversation history is preserved

**Benefits:**
- Track evolution of scheduled task outputs over time
- Agent learns from previous executions
- One session per schedule (not 30 separate sessions after a month)
- Easy to review the complete history of a scheduled task

**Edge Cases:**
- If you delete the session, the next execution creates a new one
- If the session is currently processing, the scheduled message queues
- One-time schedules create a session that persists for review

## Managing Schedules

### Schedule List

The schedule list shows all your schedules with:
- **Status badge**: Green (success), Yellow (running), Red (failed), Gray (not run yet)
- **Toggle switch**: Enable/disable the schedule
- **Next run time**: When the schedule will execute next
- **Last run status**: Success or failure indicator with error details

### Schedule Actions

Click the menu (⋯) on any schedule to:

**Run Now**: Execute the schedule immediately without waiting for the scheduled time

**Edit**: Modify the schedule:
- Change the name, prompt, or timing
- Schedule is automatically restarted with new settings
- Session continues (doesn't create a new one)

**Delete**: Remove the schedule permanently:
- Stops the schedule from running
- Session is preserved (not deleted)

### Schedule Details

Click on a schedule to view:
- Full prompt text
- Cron expression with human-readable translation
- Execution history with timestamps
- Link to the associated session
- Error messages (if any failures occurred)

## Best Practices

### Prompt Design

**Be specific about what you want:**
```
Good: "Summarize today's calendar events and list my top 3 priorities"
Bad: "What's happening today?"
```

**Include context for recurring tasks:**
```
"Check for new GitHub issues in vespr repo and summarize any that need triage"
```

**Use skills via prompts:**
```
"Run the /commit skill to commit any staged changes with an auto-generated message"
```

### Timing Considerations

**Weekday schedules for work tasks:**
```
0 9 * * 1-5  (9 AM Monday-Friday)
```

**Avoid peak hours for resource-intensive tasks:**
```
0 2 * * *  (2 AM daily - off-peak)
```

**Stagger multiple schedules:**
```
Morning briefing: 0 9 * * *
Afternoon review: 0 14 * * *
End of day: 0 17 * * *
```

### Permission Modes

Schedules run in "safe" mode by default (read-only). To enable write operations:

1. The agent will ask for permission during execution
2. You'll receive a notification requesting approval
3. Consider carefully before allowing destructive operations

### Session Management

**When to start a fresh session:**
- The conversation context has grown too large
- You want to change the task significantly
- Previous outputs are no longer relevant

**How to reset:**
1. Delete the existing session
2. Next execution creates a new one automatically

**Session naming:**
- Sessions are named "Schedule: [schedule name]"
- Rename the session if you want a different title
- The schedule will continue using it

### Monitoring

**Check execution history regularly:**
- Review the schedule detail panel
- Look for failed runs (red status)
- Check error messages for issues

**Use notifications:**
- Click notification to open the session
- Review the agent's output
- Respond or adjust the schedule as needed

### Performance Tips

**Limit long-running schedules:**
- Default timeout is 10 minutes
- Break complex tasks into smaller schedules
- Consider one-time schedules for intensive operations

**Manage context window growth:**
- SDK auto-compaction handles this automatically
- If you notice slowdowns, start a fresh session
- Most schedules won't hit limits

## Limitations

### Application Must Be Open

Schedules only execute when Vespr is running. If the app is closed:
- Scheduled tasks will not run
- Upon reopening, missed schedules are **not** retroactively executed
- Consider leaving the app running for critical schedules

### Execution History

Only the last run status is stored inline. For full execution history:
- Review the associated session
- All outputs are preserved in conversation history
- Session includes timestamps for each execution

### Skills Execution

Native skill scheduling is not supported in the current version. Workaround:
- Invoke skills via prompt text: "Run the /commit skill"
- The agent will execute the skill when processing the message

## Troubleshooting

### Schedule Not Running

**Check if the schedule is enabled:**
- Toggle switch should be on (green)
- Status badge shows current state

**Verify the cron expression:**
- Look at "Next run" time in the schedule card
- If it shows "Invalid schedule", edit and fix the expression

**Ensure the app is open:**
- Schedules only run when Vespr is active
- Status indicator shows "Schedules active"

### Failed Execution

**Review the error message:**
- Click the red status badge or error icon
- Check the schedule detail panel for full error

**Common causes:**
- Network issues (API timeout)
- Permission denied (safe mode blocking writes)
- Invalid prompt (agent couldn't parse the request)

**Resolution:**
- Fix the underlying issue
- Use "Run Now" to test immediately
- Edit the schedule if the prompt needs changes

### Session Not Found

If you see "Session not found" errors:
- The associated session was deleted
- Next execution will create a new session automatically
- No action needed - this is handled gracefully

### Context Window Issues

If the agent reports context limits:
- Delete the current session
- Next execution creates a fresh one
- Consider reducing execution frequency

## Data Storage

Schedules are stored in:
```
~/.vespr/workspaces/{workspaceId}/schedules.json
```

This JSON file contains:
- All schedule definitions
- Last run timestamps and status
- Associated session IDs
- Cron expressions and settings

**Backup:** The file is human-readable and can be backed up or edited directly if needed.

**Logs:** Execution logs are written to `~/Library/Logs/Vespr/` for debugging.

---

*For more information about Vespr's architecture and features, see the main documentation.*
