#!/usr/bin/env node
// Tiny helper used by build-win.ps1 to resolve the claude-agent-sdk version
// from the monorepo root package.json. Avoids PowerShell↔JS escaping hell.
const path = require('path');
const pkg = require(path.resolve(process.argv[2], 'package.json'));
process.stdout.write(pkg.dependencies['@anthropic-ai/claude-agent-sdk']);