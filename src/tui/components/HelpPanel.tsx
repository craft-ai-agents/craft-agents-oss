import React from 'react';
import { Box, Text, useInput } from 'ink';

const HELP_TEXT = `
**Craft Document Assistant** - Commands

**Chat**
  Just type your message and press Enter to chat with Claude.
  Use @agentname to activate a sub-agent (e.g., @writer).

**Commands**
  /help        Show this help message
  /clear       Clear conversation history
  /paste       Paste files/images from clipboard
  /tools       List available tools (-v for details)
  /config      Show current configuration
  /prefs       Show user preferences
  /setup       Reconfigure API keys and MCP settings
  /apikey      Change Anthropic API key
  /compact     Toggle compact/expanded tool output
  /cost        Show token usage and estimated cost
  /model       Show or change model (e.g., /model opus)
  /exit        Exit the application (or Ctrl+C)

**Workspace Commands**
  /workspace          Switch workspace (or /w)
  /workspace add      Add a new Craft MCP workspace
  /workspace rename   Rename current workspace
  /workspace remove   Remove a workspace

**Sub-Agent Commands**
  /agent              Show agent menu
  /agent list         List available agents
  /agent info         Show active agent details
  /agent refresh      Reload agent list from Craft
  /agent reload       Reload active agent's instructions
  /agent reset        Fully reset active agent
  /agent clear        Deactivate current agent

**Capability Toggles**
  /web         Toggle web search capability
  /fetch       Toggle web fetch capability
  /bash        Toggle bash/shell execution
  /auth        Authenticate MCP servers for active agent
  /debug       Show debug info and file paths
  /feedback    Send feedback email with session transcript

**Keyboard Shortcuts**
  Enter      Send message
  Up/Down    Navigate command history
  Backspace  Remove last attached file (when input is empty)
  Ctrl+C     Interrupt / Exit
  Ctrl+U     Clear input line
  Esc        Interrupt current operation

**Attaching Files**
  Drag & drop   Drag file into terminal window
  /paste        Paste from clipboard (Cmd+C a file first)
  Type path     Include /path/to/file in your message

**Ghostty Users**
  By default Ghostty uses Ctrl+Shift+V for paste.
  Add to ~/.config/ghostty/config:
    keybind = performable:ctrl+v=paste_from_clipboard

**Examples**
  "Show me today's daily note"
  "Search for meeting notes about project X"
  "@writer Help me draft an email"
  "What's the weather in NYC?" (uses web search)
`.trim();

interface HelpPanelProps {
  onClose: () => void;
}

export const HelpPanel: React.FC<HelpPanelProps> = ({ onClose }) => {
  useInput((input, key) => {
    if (key.escape || key.return || input === 'q') {
      onClose();
    }
  });

  // Simple rendering - split into sections
  const lines = HELP_TEXT.split('\n');

  return (
    <Box flexDirection="column" paddingX={1}>
      {lines.map((line, index) => {
        // Bold headers (lines starting with **)
        if (line.startsWith('**') && line.endsWith('**')) {
          const text = line.replace(/\*\*/g, '');
          return (
            <Box key={index} marginTop={index > 0 ? 1 : 0}>
              <Text bold color="blue">{text}</Text>
            </Box>
          );
        }
        // Command lines (indented with /)
        if (line.trim().startsWith('/')) {
          const parts = line.match(/^(\s*)(\S+)(\s+)(.*)$/);
          if (parts) {
            return (
              <Text key={index}>
                {parts[1]}<Text color="cyan">{parts[2]}</Text>{parts[3]}<Text dimColor>{parts[4]}</Text>
              </Text>
            );
          }
        }
        // Regular text
        return <Text key={index} dimColor={line.startsWith('  ')}>{line}</Text>;
      })}
      <Box marginTop={1}>
        <Text dimColor>Press Esc, Enter, or q to close</Text>
      </Box>
    </Box>
  );
};
