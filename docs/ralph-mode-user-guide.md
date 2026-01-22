# Ralph Mode User Guide

Welcome to the Ralph Mode user guide! This document will help you understand and use Ralph Mode and Ralph Loop in Vesper to automate your coding workflows.

---

## Table of Contents

1. [What is Ralph Mode?](#what-is-ralph-mode)
2. [How to Enable Ralph Mode](#how-to-enable-ralph-mode)
3. [What is Ralph Loop?](#what-is-ralph-loop)
4. [Writing a PRD for Ralph Loop](#writing-a-prd-for-ralph-loop)
5. [Starting a Ralph Loop](#starting-a-ralph-loop)
6. [Monitoring Progress](#monitoring-progress)
7. [Controlling the Loop](#controlling-the-loop)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## What is Ralph Mode?

Ralph Mode is an autonomous execution mode in Vesper that allows the AI assistant to work through tasks without asking for your permission at each step. Think of it as putting Vesper on "autopilot" for a series of related tasks.

### When to Use Ralph Mode

Ralph Mode is ideal when you have:

- **Multiple related tasks** that need to be completed in sequence
- **Repetitive work** that follows a predictable pattern
- **A clear plan** written out in a document (called a PRD)
- **Tasks that don't require your input** at each step

### How Ralph Mode Differs from Other Modes

Vesper has four permission modes. Here's how they compare:

| Mode | What It Does | Best For |
|------|-------------|----------|
| **Explore** (Grey) | Read-only mode. Vesper can look at your code but won't make any changes. | Exploring a new codebase safely |
| **Ask to Edit** (Amber) | Vesper asks your permission before making changes or running commands. | Normal day-to-day work |
| **Execute** (Purple) | Vesper makes changes without asking, but works on one task at a time. | Trusted single tasks |
| **Ralph** (Orange) | Vesper works through a list of tasks automatically, one after another. | Automated multi-task workflows |

Ralph Mode gives Vesper the same capabilities as Execute mode, but it's specifically designed for working through multiple tasks automatically.

---

## How to Enable Ralph Mode

### Using the Permission Mode Dropdown

1. Look at the bottom of the chat window where you see the current mode indicator
2. Click on the mode dropdown (it shows the current mode name like "Ask to Edit")
3. Select **"Ralph"** from the dropdown menu

### Recognizing Ralph Mode

When Ralph Mode is active, you'll notice:

- The mode indicator turns **orange** (a warning color to remind you that autonomous execution is active)
- A lightning bolt icon appears next to the mode name
- The label shows **"Ralph"**

### What Happens When You Switch to Ralph Mode

When you enable Ralph Mode:

- Vesper gains full permission to read and write files
- Commands can run without asking for your confirmation
- The interface signals that you're in an autonomous workflow state
- Vesper is ready to process tasks from a PRD document

**Note:** Ralph Mode is typically activated automatically when you start a Ralph Loop. You don't usually need to enable it manually.

---

## What is Ralph Loop?

Ralph Loop is a feature that lets Vesper work through a list of tasks automatically. You provide a document (called a PRD or Product Requirements Document) with your tasks listed as checkboxes, and Vesper works through them one by one.

### How It Works

1. You write a PRD with a list of tasks (called "stories")
2. You start the Ralph Loop
3. Vesper reads the first unchecked task and works on it
4. When complete, Vesper marks that task as done and moves to the next
5. This continues until all tasks are finished (or you stop the loop)

### The Concept of Stories

In Ralph Loop, each task is called a "story." Stories are small, focused pieces of work that Vesper can complete independently. For example:

- "Add a login button to the header"
- "Create a password reset form"
- "Update the footer copyright year"

---

## Writing a PRD for Ralph Loop

A PRD (Product Requirements Document) is simply a markdown file with a list of tasks formatted as checkboxes. Ralph Loop reads this document to know what work needs to be done.

### The Basic Format

Here's the structure your PRD should follow:

```markdown
# Feature Name

## Overview
A brief description of what you're building.

## User Stories

### [ ] US-001: First task title
Description of what needs to be done for this task.
- Acceptance criteria or details
- More details if needed

### [ ] US-002: Second task title
Description of the second task.

### [ ] US-003: Third task title
Description of the third task.
```

### A Real Example You Can Copy

```markdown
# User Authentication Feature

## Overview
Add basic user authentication to the application.

## User Stories

### [ ] US-001: Create login form component
Create a new LoginForm component with:
- Email input field with validation
- Password input field
- Submit button
- Error message display area

### [ ] US-002: Add form styling
Style the login form to match our design system:
- Use existing color variables
- Add proper spacing and padding
- Make the form responsive

### [ ] US-003: Connect form to authentication API
Wire up the login form to the backend:
- Call the /auth/login endpoint on submit
- Handle success and error responses
- Store the auth token on success
```

### Understanding the Format

Let's break down what each part means:

- `### [ ] US-001: Title` - This is a task header
  - `###` - Makes it a heading level 3
  - `[ ]` - An unchecked checkbox (empty square brackets)
  - `US-001` - A unique identifier for the story
  - `:` - Separates the ID from the title
  - `Title` - A short description of the task

- The text below the header provides context and details for Vesper to understand what to do.

### Tips for Writing Good Stories

1. **Keep each story small and focused**
   - Good: "Add email validation to the form"
   - Not as good: "Build the entire authentication system"

2. **Be specific about what you want**
   - Good: "Create a Button component with primary and secondary variants"
   - Not as good: "Make some buttons"

3. **Include acceptance criteria**
   - List out the specific requirements as bullet points
   - This helps Vesper know when the task is complete

4. **Make stories independent**
   - Each story should be completable on its own
   - Avoid stories that depend on each other when possible

5. **Use descriptive titles**
   - The title should clearly indicate what the story achieves
   - Someone should understand the goal just from the title

### Common Mistakes to Avoid

| Mistake | Why It's a Problem | Better Approach |
|---------|-------------------|-----------------|
| Stories that are too large | Vesper may timeout or lose focus | Break into smaller pieces |
| Vague descriptions | Vesper doesn't know exactly what to do | Be specific and detailed |
| Missing acceptance criteria | Hard to know when the task is done | Add bullet points with requirements |
| Duplicate story IDs | Can cause confusion in tracking | Use unique IDs like US-001, US-002 |
| Wrong checkbox format | Stories won't be detected | Use exactly `[ ]` with one space |

---

## Starting a Ralph Loop

### How to Initiate the Loop

1. **Prepare your PRD**: Create a markdown file with your stories using the format described above
2. **Open Vesper**: Make sure you have a session active
3. **Start the loop**: You can start a Ralph Loop by:
   - Providing your PRD content in the chat
   - Referencing a PRD file in your project

### Configuration Options

When starting a loop, you can customize these settings:

| Option | What It Does | Default |
|--------|-------------|---------|
| **Max Iterations per Story** | How many attempts Vesper gets to complete each story | 5 |
| **Timeout per Story** | Maximum time allowed for each story | 10 minutes |
| **Auto-commit** | Whether to automatically save changes to git | Yes |
| **Commit Prefix** | The prefix used for git commit messages | "feat" |

For most users, the default settings work well. You only need to adjust these if:

- Your stories are complex and need more iterations
- Your stories involve long-running operations
- You want to commit changes yourself

### What to Expect When It Starts

When you start a Ralph Loop:

1. Vesper parses your PRD to find all the stories
2. The permission mode switches to Ralph (orange)
3. A progress indicator appears in the chat
4. Vesper begins working on the first unchecked story
5. You'll see real-time updates as work progresses

---

## Monitoring Progress

Once a Ralph Loop is running, you can monitor its progress through the progress indicator in the chat interface.

### Understanding the Progress Indicator

The progress indicator shows:

```
Running | Story 3/5 [=======>     ] | US-003 Add auth | 4m 32s | [||] [X]
```

Let's break this down:

- **Running**: The current status (Running, Paused, Completed, etc.)
- **Story 3/5**: Which story is being worked on (3rd of 5 total)
- **Progress bar**: Visual representation of overall progress
- **US-003 Add auth**: The ID and title of the current story
- **4m 32s**: How long the loop has been running
- **[||] [X]**: Pause and Cancel buttons

### Story Status

Each story can have one of these statuses:

| Status | What It Means |
|--------|--------------|
| **Pending** | Story hasn't been started yet |
| **In Progress** | Vesper is currently working on this story |
| **Completed** | Story was finished successfully |
| **Failed** | Story encountered an error and couldn't be completed |
| **Skipped** | Story was skipped (usually due to timeout or too many attempts) |

### What the Iteration Counter Means

For each story, Vesper may make multiple attempts (called "iterations") to complete it. For example, "Iteration 2/5" means:

- Vesper is on its 2nd attempt at the current story
- A maximum of 5 attempts are allowed
- If all 5 attempts don't succeed, the story is marked as failed or skipped

Each iteration is a complete try at the story. Vesper learns from previous attempts to improve in the next iteration.

---

## Controlling the Loop

You have full control over the Ralph Loop at any time.

### How to Pause

Click the **Pause button** (looks like two vertical bars ||) in the progress indicator.

When you pause:
- Vesper finishes the current operation
- The loop stops before starting the next story
- All progress is preserved
- You can resume whenever you're ready

**When to pause:**
- You need to review the work so far
- You want to make manual adjustments
- You need to step away from your computer

### How to Resume

Click the **Resume button** (appears where the pause button was) to continue.

When you resume:
- The loop picks up where it left off
- It starts with the next pending story
- Previous progress is maintained

### How to Cancel

Click the **Cancel button** (looks like an X) to stop the loop entirely.

When you cancel:
- The current operation stops
- The loop ends immediately
- Completed stories remain completed
- Pending stories stay pending (you can start a new loop later)

**When to cancel:**
- You realize the PRD needs significant changes
- Something went wrong that needs fixing
- You want to take a different approach

### What Happens to Partial Work

If you pause or cancel a loop:

- **Completed stories**: Changes are committed to git (if auto-commit is enabled)
- **In-progress story**: The current story's changes remain in your working directory
- **Pending stories**: Not started, no changes made

You can always:
1. Review uncommitted changes
2. Commit them manually if desired
3. Discard them if needed
4. Start a new loop to continue

---

## Best Practices

Follow these recommendations to get the most out of Ralph Loop.

### Keep Stories Small and Focused

**Do this:**
```markdown
### [ ] US-001: Add email input field to login form
### [ ] US-002: Add password input field to login form
### [ ] US-003: Add form validation for email
### [ ] US-004: Add form validation for password
```

**Instead of:**
```markdown
### [ ] US-001: Build the entire login form with all validation
```

Small stories are:
- Easier for Vesper to complete successfully
- Faster to execute
- Easier to review and verify

### Test with Simple Tasks First

Before running a long PRD with many stories:

1. Create a small PRD with 2-3 simple stories
2. Run the loop and observe how it works
3. Review the results
4. Once comfortable, run larger PRDs

This helps you:
- Understand how Ralph Loop works
- Identify any issues with your PRD format
- Build confidence before automating more work

### Review Commits After Completion

When the loop finishes:

1. **Check the git log**: See what commits were made
2. **Review the changes**: Look at what was actually changed
3. **Test the code**: Make sure everything works as expected
4. **Make adjustments**: Fix anything that needs tweaking

Remember: Ralph Loop automates the work, but you're still responsible for the final quality.

### Additional Tips

- **Write clear descriptions**: The more context you provide, the better the results
- **Use consistent naming**: Keep your story IDs organized (US-001, US-002, etc.)
- **Start fresh**: Begin with a clean working directory when possible
- **Save your PRD**: Keep your PRD file for reference and future use
- **Monitor the first few stories**: Watch how Vesper handles them before stepping away

---

## Troubleshooting

Here are solutions to common issues you might encounter.

### Common Issues and Solutions

#### Stories aren't being detected

**Symptoms:** Ralph Loop says there are no stories to process.

**Solutions:**
- Make sure your checkboxes use the exact format: `### [ ] ID: Title`
- Check that there's a space between the square brackets: `[ ]` not `[]`
- Verify each story has a colon after the ID
- Ensure your story IDs contain at least one number (e.g., US-001, not US-ABC)

#### A story keeps failing

**Symptoms:** The same story fails multiple times and gets skipped.

**Solutions:**
- Review the story description - is it clear enough?
- Break the story into smaller pieces
- Check if the story depends on something that doesn't exist yet
- Look at the error messages for clues
- Try running the story manually first

#### The loop is too slow

**Symptoms:** Each story takes a very long time.

**Solutions:**
- Make your stories smaller and more focused
- Check if your stories are doing too much
- Consider reducing the number of iterations per story
- Ensure your computer has adequate resources

#### Changes aren't being committed

**Symptoms:** Stories complete but no git commits appear.

**Solutions:**
- Verify you're in a git repository
- Check that auto-commit is enabled
- Ensure there are actual file changes to commit
- Look for git errors in the output

#### The loop stops unexpectedly

**Symptoms:** The loop ends before all stories are complete.

**Solutions:**
- Check if an error occurred (look for error messages)
- Verify your PRD format is correct
- Check if you accidentally clicked cancel
- Review the timeout settings

### What to Do If a Story Fails

When a story fails:

1. **Check the error message**: It often tells you what went wrong
2. **Review the story description**: Was it clear and complete?
3. **Look at partial changes**: See what Vesper attempted
4. **Revise the story**: Rewrite it to be clearer or simpler
5. **Try again**: You can start a new loop to retry failed stories

### Error Codes Explained

| Error | What It Means | What to Do |
|-------|--------------|------------|
| **Timeout** | Story took too long | Break into smaller pieces or increase timeout |
| **Agent Error** | Vesper encountered a problem | Check the story description and try again |
| **Git Error** | Problem with git operations | Ensure you're in a valid git repository |
| **Permission Denied** | Access was blocked | Check your project permissions |

### Getting More Help

If you continue to have issues:

- Review your PRD format against the examples in this guide
- Try starting with a very simple PRD (one or two basic stories)
- Check that your project is set up correctly (valid git repository, etc.)

---

## Quick Reference

### PRD Template

```markdown
# [Feature Name]

## Overview
[Brief description of the feature]

## User Stories

### [ ] US-001: [Story title]
[Description and acceptance criteria]

### [ ] US-002: [Story title]
[Description and acceptance criteria]
```

### Keyboard of Controls

| Action | How to Do It |
|--------|-------------|
| Pause the loop | Click the pause button (||) |
| Resume the loop | Click the resume button |
| Cancel the loop | Click the cancel button (X) |
| Check progress | View the progress indicator |

### Status Colors

| Color | Mode |
|-------|------|
| Grey | Explore (read-only) |
| Amber | Ask to Edit (prompts for permission) |
| Purple | Execute (full access, single task) |
| **Orange** | **Ralph (autonomous loop)** |

---

Happy automating with Ralph Loop!
