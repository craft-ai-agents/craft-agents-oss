import type { HelpContent } from '../types'
import type { InlineHelpFeature } from '../types'

export const enUS: Record<InlineHelpFeature, HelpContent> = {
  sources: {
    title: 'Sources',
    summary: 'Sources connect your agent to external data and services.',
    sections: [
      {
        heading: 'What are Sources?',
        paragraphs: [
          'Sources give your agent access to external tools and data. When you connect a source, the agent can use it during conversations to read, search, and interact with services.',
        ],
      },
      {
        heading: 'Types of Sources',
        items: [
          'MCP Servers — Rich tool integrations for services like GitHub, Linear, Notion, and more. MCP (Model Context Protocol) provides structured access with typed inputs and outputs.',
          'REST APIs — Connect to any HTTP API with flexible authentication. Make GET, POST, PUT, and DELETE requests to external services.',
          'Local Folders — Give your agent read access to directories on your machine, like Obsidian vaults, code repositories, or data folders.',
        ],
      },
      {
        heading: 'How Sources Work',
        paragraphs: [
          'Each source lives in your workspace under ~/.g4os/workspaces/{id}/sources/{slug}/. It contains a config.json with connection details and an optional guide.md that describes how to use the source.',
          'The guide.md file is injected into the agent\'s context, teaching it when and how to use the source\'s tools. You can customize this file to fine-tune behavior.',
        ],
      },
      {
        heading: 'Permissions',
        paragraphs: [
          'Sources respect the session\'s permission mode. In Explore mode, the agent can only read data. In Ask to Edit mode, it will prompt before making changes. In Execute mode, all operations are auto-approved.',
          'You can also configure per-source permissions in a permissions.json file alongside the source config.',
        ],
      },
    ],
  },

  'sources-api': {
    title: 'API Sources',
    summary: 'Connect to any REST API with flexible authentication.',
    sections: [
      {
        heading: 'What are API Sources?',
        paragraphs: [
          'API sources let your agent make HTTP requests to any REST API. Configure the base URL, authentication, and the agent can call endpoints during conversations.',
        ],
      },
      {
        heading: 'Configuration',
        paragraphs: [
          'Each API source needs a base URL and optionally an authentication method. The config is stored in the source\'s config.json file.',
        ],
      },
      {
        heading: 'Authentication Types',
        items: [
          'Bearer Token — Send an Authorization header with a bearer token.',
          'API Key — Send a custom header (e.g., X-API-Key) with your key.',
          'Basic Auth — HTTP Basic authentication with username and password.',
          'OAuth 2.0 — Client credentials or authorization code flow.',
          'None — No authentication required.',
        ],
      },
      {
        heading: 'Test Endpoint',
        paragraphs: [
          'You can configure a test endpoint to verify the connection is working. The app will call this endpoint when you add the source and show the connection status.',
        ],
      },
      {
        heading: 'MCP vs API Sources',
        paragraphs: [
          'MCP sources provide structured tools with typed inputs/outputs and are ideal for well-known services with existing MCP servers. API sources are more flexible and work with any HTTP API, but require more configuration and the agent uses them in a less structured way.',
        ],
      },
    ],
  },

  'sources-mcp': {
    title: 'MCP Servers',
    tabs: [
      {
        id: 'overview',
        label: 'Overview',
        page: {
          title: 'MCP Overview',
          summary: 'Model Context Protocol servers provide structured tool access.',
          sections: [
            {
              heading: 'What is MCP?',
              paragraphs: [
                'MCP (Model Context Protocol) is an open standard for connecting AI agents to external tools and data sources. MCP servers expose a set of tools that your agent can call during conversations.',
              ],
            },
            {
              heading: 'How MCP Works',
              paragraphs: [
                'When you connect an MCP server, G4 OS discovers its available tools and makes them available to the agent. Each tool has a name, description, and typed input schema that the agent uses to call it correctly.',
                'MCP servers can run locally (stdio) or remotely (SSE/HTTP). Local servers are spawned as subprocesses; remote servers connect over the network.',
              ],
            },
            {
              heading: 'Popular MCP Servers',
              items: [
                'GitHub — Issues, PRs, repositories, code search',
                'Linear — Issues, projects, teams',
                'Notion — Pages, databases, search',
                'Slack — Messages, channels, users',
                'Filesystem — File read/write with path restrictions',
                'PostgreSQL — Database queries (read-only by default)',
              ],
            },
          ],
        },
      },
      {
        id: 'connecting',
        label: 'Connecting',
        page: {
          title: 'Connecting MCP Servers',
          summary: 'How to add and configure MCP server connections.',
          sections: [
            {
              heading: 'Adding an MCP Server',
              paragraphs: [
                'Use the "Add Source" button in the sidebar or click "+" in the Sources panel. Select "MCP Server" and provide the connection details.',
              ],
            },
            {
              heading: 'Connection Types',
              items: [
                'stdio — Runs the server as a local subprocess. Provide the command and arguments (e.g., npx @modelcontextprotocol/server-github).',
                'SSE — Connects to a remote server via Server-Sent Events. Provide the URL endpoint.',
                'Streamable HTTP — Connects via HTTP streaming. Provide the URL endpoint.',
              ],
            },
            {
              heading: 'Environment Variables',
              paragraphs: [
                'Many MCP servers need environment variables for configuration (e.g., GITHUB_TOKEN). You can set these in the source config and they\'ll be passed to the subprocess.',
              ],
            },
            {
              heading: 'guide.md',
              paragraphs: [
                'Each source can have a guide.md file that teaches the agent when and how to use the tools. This is injected into the system prompt. You can customize it to add usage examples or restrict which tools the agent should prefer.',
              ],
            },
          ],
        },
      },
      {
        id: 'auth',
        label: 'Authentication',
        page: {
          title: 'MCP Authentication',
          summary: 'Configuring authentication for MCP servers.',
          sections: [
            {
              heading: 'Environment-Based Auth',
              paragraphs: [
                'Most MCP servers use environment variables for authentication. Set tokens like GITHUB_TOKEN, LINEAR_API_KEY, etc. in the source\'s environment configuration. These are securely stored in the encrypted credentials file.',
              ],
            },
            {
              heading: 'OAuth Authentication',
              paragraphs: [
                'Some MCP servers support OAuth for authentication. G4 OS can handle the OAuth flow — when the agent triggers authentication, a browser window opens for you to authorize access. The tokens are stored securely and refreshed automatically.',
              ],
            },
            {
              heading: 'Credential Storage',
              paragraphs: [
                'All credentials are stored in ~/.g4os/credentials.enc, encrypted with AES-256-GCM. They are never stored in plain text or committed to source control.',
              ],
            },
          ],
        },
      },
    ],
  },

  'sources-local': {
    title: 'Local Folders',
    summary: 'Give your agent access to local directories on your machine.',
    sections: [
      {
        heading: 'What are Local Folder Sources?',
        paragraphs: [
          'Local folder sources give your agent read access to directories on your machine. This is useful for knowledge bases like Obsidian vaults, documentation folders, or data directories.',
        ],
      },
      {
        heading: 'Configuration',
        paragraphs: [
          'When adding a local folder source, select the directory you want to share. The agent will be able to read files within that directory and its subdirectories.',
        ],
      },
      {
        heading: 'guide.md',
        paragraphs: [
          'You can create a guide.md file in the source folder to describe its contents and teach the agent how to navigate the files. For example, explain the folder structure or highlight important files.',
        ],
      },
      {
        heading: 'Permissions',
        paragraphs: [
          'Local folder sources are read-only by default. The agent can search and read files but cannot modify them. You can configure write access by adding allowedWritePaths in the source\'s permissions.json.',
        ],
      },
      {
        heading: 'Local Folders vs Working Directory',
        paragraphs: [
          'The working directory is the folder where the agent runs commands (like a terminal). Local folder sources are different — they provide structured file access without running commands. This makes them safer for knowledge base access.',
        ],
      },
    ],
  },

  skills: {
    title: 'Skills',
    summary: 'Reusable instruction sets that teach your agent specialized behaviors.',
    sections: [
      {
        heading: 'What are Skills?',
        paragraphs: [
          'Skills are reusable instructions that teach your agent specialized behaviors. Each skill is defined by a SKILL.md file that contains a system prompt fragment — instructions, examples, and guidelines for a specific task.',
        ],
      },
      {
        heading: 'Creating a Skill',
        paragraphs: [
          'Create a skill by adding a folder under ~/.g4os/workspaces/{id}/skills/{slug}/ with a SKILL.md file. The file should contain clear instructions for the behavior you want.',
        ],
        items: [
          'Give it a descriptive name and description in the metadata header.',
          'Write clear, specific instructions in the body.',
          'Include examples of expected input/output when helpful.',
          'Keep instructions focused on a single task or domain.',
        ],
      },
      {
        heading: 'Invoking Skills',
        paragraphs: [
          'Invoke a skill by @mentioning its name in your message. The skill\'s instructions are injected into the agent\'s context for that turn, guiding its behavior.',
          'You can also set skills to auto-activate for all messages in a session, useful for persistent behaviors like coding style guides.',
        ],
      },
      {
        heading: 'Skill Metadata',
        paragraphs: [
          'Skills support a YAML frontmatter header with metadata like name, description, icon, and activation rules. The description helps the agent understand when to suggest using the skill.',
        ],
      },
    ],
  },
}
