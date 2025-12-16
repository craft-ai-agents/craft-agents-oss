
import { $ } from 'bun';
import { create } from 'tar';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

const CRAFT_AGENT_CLI_VERSION = process.argv[2];
if (!CRAFT_AGENT_CLI_VERSION) {
  console.error('Version is required');
  process.exit(1);
}

const CRAFT_AGENT_CLI_BUILD_DATE = new Date().toISOString();
const CRAFT_AGENT_CLI_BUILD_TIMESTAMP = Date.now();

// Build targets
const TARGETS = [
  { name: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', ext: '' },
  { name: 'darwin-x64', bunTarget: 'bun-darwin-x64', ext: '' },
  { name: 'linux-x64', bunTarget: 'bun-linux-x64', ext: '' },
  { name: 'linux-arm64', bunTarget: 'bun-linux-arm64', ext: '' },
] as const;

// Get repo root (one level up from scripts/)
const scriptDir = import.meta.dir;
const repoRoot = dirname(scriptDir);
const buildDir = join(repoRoot, '.build');
if (existsSync(buildDir)) {
    rmSync(buildDir, { recursive: true });
}
mkdirSync(buildDir, { recursive: true });

// Build each target
console.log(`Building version ${CRAFT_AGENT_CLI_VERSION}...`);
console.log(`Build time: ${CRAFT_AGENT_CLI_BUILD_DATE}`);
console.log(`Build timestamp: ${CRAFT_AGENT_CLI_BUILD_TIMESTAMP}`);
console.log(`Build directory: ${buildDir}`);
console.log('');

const manifest: {
  version: string;
  build_time: string;
  build_timestamp: number;
  binaries: Record<string, { url: string; sha256: string; size: number }>;
} = {
  version: CRAFT_AGENT_CLI_VERSION,
  build_time: CRAFT_AGENT_CLI_BUILD_DATE,
  build_timestamp: CRAFT_AGENT_CLI_BUILD_TIMESTAMP,
  binaries: {},
};

mkdirSync(join(buildDir, "upload"), { recursive: true });

for (const target of TARGETS) {
  const folder = join(buildDir, `${target.name}`);
  mkdirSync(folder, { recursive: true });
  const outfile = join(folder, "craft");

  console.log(`Building ${target.name}...`);

  try {
    console.log(await $`bun build --compile --minify \
      --target=${target.bunTarget} \
      --define CRAFT_AGENT_CLI_VERSION='"${CRAFT_AGENT_CLI_VERSION}"' \
      --define CRAFT_AGENT_CLI_BUILD_DATE='"${CRAFT_AGENT_CLI_BUILD_DATE}"' \
      --define CRAFT_AGENT_CLI_BUILD_TIMESTAMP='"${CRAFT_AGENT_CLI_BUILD_TIMESTAMP}"' \
      --outfile ${outfile} \
      apps/tui/src/index.tsx
      `.text());
    console.log(await $`cp -r node_modules/@anthropic-ai/claude-agent-sdk ${folder}`.text());
    
    // Copy cache-ttl-interceptor.ts for preload by Bun subprocess
    // Note: Bundling breaks the fetch interception logic, must use original TS
    console.log(await $`cp src/cache-ttl-interceptor.ts ${folder}`.text());

    await create({
        gzip: true,
        file: join(buildDir, "upload", `${target.name}.tar.gz`),
        C: folder,
    }, ['craft', 'claude-agent-sdk', 'cache-ttl-interceptor.ts']);

    const content = readFileSync(join(buildDir, "upload", `${target.name}.tar.gz`));
    const hash = createHash('sha256').update(content).digest('hex');
    const size = content.length;

    console.log(`  ✓ ${outfile} (${(size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`    SHA256: ${hash}`);

    manifest.binaries[target.name] = {
      url: `https://agents.craft.do/${CRAFT_AGENT_CLI_VERSION}/${target.name}.tar.gz`,
      sha256: hash,
      size,
    };
  } catch (error) {
    console.error(`  ✗ Failed to build ${target.name}:`, error);
  }

  console.log('');
}

// Write manifest
const manifestPath = join(buildDir, "upload", 'manifest.json');
Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Manifest written to ${manifestPath}`);