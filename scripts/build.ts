
import { $ } from 'bun';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

const VERSION = process.argv[2];
if (!VERSION) {
  console.error('Version is required');
  process.exit(1);
}

const BUILD_TIME = new Date().toISOString();
const BUILD_TIMESTAMP = Date.now();

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
console.log(`Building version ${VERSION}...`);
console.log(`Build time: ${BUILD_TIME}`);
console.log(`Build timestamp: ${BUILD_TIMESTAMP}`);
console.log(`Build directory: ${buildDir}`);
console.log('');

const manifest: {
  version: string;
  build_time: string;
  build_timestamp: number;
  binaries: Record<string, { url: string; sha256: string; size: number }>;
} = {
  version: VERSION,
  build_time: BUILD_TIME,
  build_timestamp: BUILD_TIMESTAMP,
  binaries: {},
};

for (const target of TARGETS) {
  const outfile = join(buildDir, `craft-${target.name}${target.ext}`);

  console.log(`Building ${target.name}...`);

  try {
    await $`bun build --compile --minify \
      --target=${target.bunTarget} \
      --external yoga-wasm-web \
      --external keytar \
      --define VERSION="${VERSION}" \
      --define BUILD_TIME="${BUILD_TIME}" \
      --define BUILD_TIMESTAMP="${BUILD_TIMESTAMP}" \
      src/index.tsx \
      --outfile ${outfile}`.quiet();

    // Calculate SHA256
    const content = readFileSync(outfile);
    const hash = createHash('sha256').update(content).digest('hex');
    const size = content.length;

    console.log(`  ✓ ${outfile} (${(size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`    SHA256: ${hash}`);

    manifest.binaries[target.name] = {
      url: `https://version.chaps.app/${VERSION}/${target.name}${target.ext}`,
      sha256: hash,
      size,
    };
  } catch (error) {
    console.error(`  ✗ Failed to build ${target.name}:`, error);
  }

  console.log('');
}

// Write manifest
const manifestPath = join(buildDir, 'manifest.json');
Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Manifest written to ${manifestPath}`);