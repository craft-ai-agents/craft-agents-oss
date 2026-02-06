# Cloudflare Sandbox container for remote Claude Code execution
FROM docker.io/cloudflare/sandbox:0.7.0

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Configure Claude Code for headless operation
ENV CLAUDE_CODE_DISABLE_UPDATES=1
ENV CLAUDE_CODE_SKIP_HOOKS=1
ENV CLAUDE_CODE_TELEMETRY=0

# Set command timeout to 5 minutes (300 seconds)
ENV COMMAND_TIMEOUT_MS=300000

# Expose port for communication
EXPOSE 3000
