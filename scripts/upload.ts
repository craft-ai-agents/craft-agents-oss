import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

const BUCKET = 'agents-craft-do';
if (!process.env.S3_VERSIONS_BUCKET_ENDPOINT || !process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID || !process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials');
  process.exit(1);
}

const isLatest = process.argv.includes('--latest');
const uploadScript = process.argv.includes('--script');
const scriptOnly = process.argv.includes('--script-only');
// Transition flag: also generate old manifest.json for existing users on the custom updater
const withLegacyManifest = process.argv.includes('--legacy-manifest');
const scriptDir = import.meta.dir;
const repoRoot = dirname(scriptDir);
const installAppShPath = join(repoRoot, 'scripts', 'install-app.sh');
const installAppPs1Path = join(repoRoot, 'scripts', 'install-app.ps1');
const electronReleaseDir = join(repoRoot, 'apps', 'electron', 'release');

// Get version from package.json
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
const version = packageJson.version;

console.log(`Uploading Electron version ${version}...`);
if (scriptOnly) {
  console.log('Script-only mode: uploading install scripts only');
} else {
  if (isLatest) {
    console.log('Will also update electron/latest');
  }
  if (withLegacyManifest) {
    console.log('Will also generate legacy manifest.json (transition release)');
  }
  if (uploadScript) {
    console.log('Will also upload install scripts (install-app.sh, install-app.ps1)');
  }
}
console.log('');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_VERSIONS_BUCKET_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY,
  },
});

/**
 * Get content type for a file based on extension
 */
function getContentType(filename: string): string {
  if (filename.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (filename.endsWith('.exe')) return 'application/x-msdownload';
  if (filename.endsWith('.AppImage')) return 'application/x-executable';
  if (filename.endsWith('.zip')) return 'application/zip';
  if (filename.endsWith('.yml') || filename.endsWith('.yaml')) return 'text/yaml';
  if (filename.endsWith('.blockmap')) return 'application/octet-stream';
  return 'application/octet-stream';
}

/**
 * Detect architecture from filename (e.g., "Craft-Agent-arm64.zip" → "arm64")
 * Used for electron-updater yml manifests so it can match the correct binary for the running arch.
 */
function detectArchFromFilename(filename: string): string {
  if (filename.includes('arm64') || filename.includes('aarch64')) return 'arm64';
  if (filename.includes('x64') || filename.includes('x86_64')) return 'x64';
  return 'x64'; // Default to x64 if undetectable
}

/**
 * Detect platform from installer filename for legacy manifest generation
 */
function detectPlatformFromFilename(filename: string): string | null {
  if (filename.endsWith('.dmg')) {
    if (filename.includes('arm64')) return 'darwin-arm64';
    if (filename.includes('x64') || filename.includes('x86_64')) return 'darwin-x64';
  }
  if (filename.endsWith('.exe')) {
    if (filename.includes('arm64')) return 'win32-arm64';
    return 'win32-x64';
  }
  if (filename.endsWith('.AppImage')) {
    if (filename.includes('arm64')) return 'linux-arm64';
    return 'linux-x64';
  }
  return null;
}

function computeSha256(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function computeSha512Base64(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha512').update(content).digest('base64');
}

/**
 * Generate electron-updater .yml manifest files from the actual binaries in the release directory.
 *
 * electron-updater reads platform-specific yml files to discover updates:
 *   - latest-mac.yml  → macOS (references .zip files, one entry per arch)
 *   - latest.yml      → Windows (references .exe)
 *   - latest-linux.yml → Linux (references .AppImage)
 *
 * We generate these here (rather than relying on electron-builder's per-runner output) because:
 *   1. macOS arm64 and x64 build on separate runners — each only knows its own arch.
 *      Generating here produces a combined manifest with both architectures.
 *   2. Windows code signing happens after the build, invalidating electron-builder's hash.
 *      Generating here uses the final (signed) binary's hash.
 *   3. Single source of truth — no dependency on whether yml files were captured as artifacts.
 */
function generateUpdateManifests(releaseDir: string, version: string): void {
  const files = readdirSync(releaseDir);
  const releaseDate = new Date().toISOString();

  // Collect available update payloads per platform
  // macOS: electron-updater downloads .zip (not .dmg) for updates
  const macZips = files.filter(f => f.endsWith('.zip') && f.startsWith('Craft-Agent-'));
  const winExes = files.filter(f => f.endsWith('.exe') && f.startsWith('Craft-Agent-'));
  const linuxAppImages = files.filter(f => f.endsWith('.AppImage') && f.startsWith('Craft-Agent-'));

  // Generate latest-mac.yml (contains entries for all available architectures)
  if (macZips.length > 0) {
    const entries = macZips
      .map(zipFile => {
        const filePath = join(releaseDir, zipFile);
        const sha512 = computeSha512Base64(filePath);
        const size = statSync(filePath).size;
        const arch = detectArchFromFilename(zipFile);
        return { url: zipFile, sha512, size, arch };
      })
      .sort((a, b) => a.arch.localeCompare(b.arch)); // Deterministic order (arm64, x64)

    // YAML format expected by electron-updater
    let yml = `version: ${version}\n`;
    yml += `files:\n`;
    for (const entry of entries) {
      yml += `  - url: ${entry.url}\n`;
      yml += `    sha512: ${entry.sha512}\n`;
      yml += `    size: ${entry.size}\n`;
      yml += `    arch: ${entry.arch}\n`;
    }
    // Top-level path/sha512 for backward compat (first entry)
    yml += `path: ${entries[0].url}\n`;
    yml += `sha512: ${entries[0].sha512}\n`;
    yml += `releaseDate: '${releaseDate}'\n`;

    writeFileSync(join(releaseDir, 'latest-mac.yml'), yml, 'utf-8');
    console.log(`  ✓ Generated latest-mac.yml (${macZips.join(', ')})`);
  }

  // Generate latest.yml (Windows)
  if (winExes.length > 0) {
    const entries = winExes.map(exeFile => {
      const filePath = join(releaseDir, exeFile);
      const sha512 = computeSha512Base64(filePath);
      const size = statSync(filePath).size;
      const arch = detectArchFromFilename(exeFile);
      return { url: exeFile, sha512, size, arch };
    });

    let yml = `version: ${version}\n`;
    yml += `files:\n`;
    for (const entry of entries) {
      yml += `  - url: ${entry.url}\n`;
      yml += `    sha512: ${entry.sha512}\n`;
      yml += `    size: ${entry.size}\n`;
      yml += `    arch: ${entry.arch}\n`;
    }
    yml += `path: ${entries[0].url}\n`;
    yml += `sha512: ${entries[0].sha512}\n`;
    yml += `releaseDate: '${releaseDate}'\n`;

    writeFileSync(join(releaseDir, 'latest.yml'), yml, 'utf-8');
    console.log(`  ✓ Generated latest.yml (${winExes.join(', ')})`);
  }

  // Generate latest-linux.yml
  if (linuxAppImages.length > 0) {
    const entries = linuxAppImages.map(appImage => {
      const filePath = join(releaseDir, appImage);
      const sha512 = computeSha512Base64(filePath);
      const size = statSync(filePath).size;
      const arch = detectArchFromFilename(appImage);
      return { url: appImage, sha512, size, arch };
    });

    let yml = `version: ${version}\n`;
    yml += `files:\n`;
    for (const entry of entries) {
      yml += `  - url: ${entry.url}\n`;
      yml += `    sha512: ${entry.sha512}\n`;
      yml += `    size: ${entry.size}\n`;
      yml += `    arch: ${entry.arch}\n`;
    }
    yml += `path: ${entries[0].url}\n`;
    yml += `sha512: ${entries[0].sha512}\n`;
    yml += `releaseDate: '${releaseDate}'\n`;

    writeFileSync(join(releaseDir, 'latest-linux.yml'), yml, 'utf-8');
    console.log(`  ✓ Generated latest-linux.yml (${linuxAppImages.join(', ')})`);
  }
}

/**
 * Legacy manifest type for backward compatibility with old custom updater.
 * Used during transition period so existing users can discover the update.
 */
type LegacyManifest = {
  version: string;
  build_time: string;
  binaries: Record<string, { url: string; sha256: string; size: number; filename: string }>;
};

/**
 * Fetch existing legacy manifest from S3 (for merging platforms from parallel builds)
 */
async function fetchExistingLegacyManifest(version: string): Promise<LegacyManifest | null> {
  const manifestKey = `electron/${version}/manifest.json`;
  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: manifestKey,
    }));
    const body = await response.Body?.transformToString();
    if (body) {
      console.log(`  Found existing legacy manifest for ${version}`);
      return JSON.parse(body) as LegacyManifest;
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey') {
      console.log(`  No existing legacy manifest for ${version}, creating new one`);
    } else {
      console.warn(`  Warning: Failed to fetch existing manifest:`, error);
    }
  }
  return null;
}

async function uploadElectronBuilds(version: string) {
  console.log('Uploading Electron builds...');

  if (!existsSync(electronReleaseDir)) {
    console.error(`  ✗ Electron release directory not found: ${electronReleaseDir}`);
    console.error('  Run: bun run electron:dist:mac (or :win, :linux)');
    process.exit(1);
  }

  let files = readdirSync(electronReleaseDir);

  // Check we have at least one distributable binary
  const hasBinaries = files.some(f =>
    f.endsWith('.dmg') || f.endsWith('.exe') || f.endsWith('.AppImage') || f.endsWith('.zip')
  );

  if (!hasBinaries) {
    console.error('  ✗ No distributable files found in release directory');
    console.error('  Run: bun run electron:dist:mac (or :win, :linux)');
    process.exit(1);
  }

  // Generate electron-updater yml manifests from actual binaries.
  // This replaces any per-runner yml files from electron-builder with correct
  // combined manifests (all architectures, post-signing hashes).
  generateUpdateManifests(electronReleaseDir, version);

  // Re-read directory after manifest generation (new .yml files may have been created)
  files = readdirSync(electronReleaseDir);

  // Upload all distributable files: binaries, zips, yml manifests, and blockmaps
  const uploadableFiles = files.filter(f =>
    f.endsWith('.dmg') || f.endsWith('.exe') || f.endsWith('.AppImage') ||
    f.endsWith('.zip') || f.endsWith('.yml') || f.endsWith('.blockmap')
  );

  console.log(`  Found ${uploadableFiles.length} files to upload`);

  // Upload each file to versioned path
  for (const file of uploadableFiles) {
    const filePath = join(electronReleaseDir, file);
    const stats = statSync(filePath);
    const content = readFileSync(filePath);
    const contentType = getContentType(file);
    const key = `electron/${version}/${file}`;

    console.log(`  Uploading ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: content,
      ContentType: contentType,
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));

    console.log(`  ✓ ${key}`);
  }

  // If --latest, copy files to electron/latest/ for stable download URLs
  // electron-updater reads .yml files from this path to discover updates
  if (isLatest) {
    console.log('Updating electron/latest/...');

    for (const file of uploadableFiles) {
      const filePath = join(electronReleaseDir, file);
      const content = readFileSync(filePath);
      const contentType = getContentType(file);
      const latestKey = `electron/latest/${file}`;

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: latestKey,
        Body: content,
        ContentType: contentType,
        CacheControl: 'no-cache, no-store, must-revalidate',
      }));

      console.log(`  ✓ ${latestKey}`);
    }

    // Also update the version pointer JSON (used by CLI install scripts)
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'electron/latest',
      Body: JSON.stringify({ version }),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log('  ✓ electron/latest (version pointer)');
  }

  // Transition: generate legacy manifest.json for existing users on the old custom updater.
  // This allows old app versions to find and download this update, which contains
  // electron-updater and will switch them to the new update system.
  // Remove --legacy-manifest flag once all users have updated past this version.
  if (withLegacyManifest) {
    console.log('Generating legacy manifest.json (transition)...');

    const installerFiles = files.filter(f =>
      f.endsWith('.dmg') || f.endsWith('.exe') || f.endsWith('.AppImage')
    );

    // Always generate fresh manifest - don't merge with existing to ensure checksums are correct
    const legacyManifest: LegacyManifest = {
      version,
      build_time: new Date().toISOString(),
      binaries: {},
    };

    for (const installerFile of installerFiles) {
      const platform = detectPlatformFromFilename(installerFile);
      if (!platform) continue;

      const filePath = join(electronReleaseDir, installerFile);
      const stats = statSync(filePath);
      const sha256 = computeSha256(filePath);

      legacyManifest.binaries[platform] = {
        url: `https://agents.craft.do/electron/${version}/${installerFile}`,
        sha256,
        size: stats.size,
        filename: installerFile,
      };
    }

    // Upload legacy manifest to versioned path
    const manifestKey = `electron/${version}/manifest.json`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: manifestKey,
      Body: JSON.stringify(legacyManifest, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log(`  ✓ ${manifestKey}`);

    // Also copy to /latest/ if applicable
    if (isLatest) {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: 'electron/latest/manifest.json',
        Body: JSON.stringify(legacyManifest, null, 2),
        ContentType: 'application/json',
        CacheControl: 'no-cache, no-store, must-revalidate',
      }));
      console.log('  ✓ electron/latest/manifest.json');
    }
  }

  // Upload install scripts if --script is set (for CLI installer, unrelated to auto-update)
  if (uploadScript) {
    console.log('Uploading install-app.sh...');
    const shContent = readFileSync(installAppShPath);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'install-app.sh',
      Body: shContent,
      ContentType: 'text/x-shellscript',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log(`  ✓ install-app.sh (${(shContent.length / 1024).toFixed(2)} KB)`);

    console.log('Uploading install-app.ps1...');
    const ps1Content = readFileSync(installAppPs1Path);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'install-app.ps1',
      Body: ps1Content,
      ContentType: 'text/plain',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log(`  ✓ install-app.ps1 (${(ps1Content.length / 1024).toFixed(2)} KB)`);
  }

  console.log('Upload complete!');
}

async function uploadScriptsOnly(): Promise<void> {
  console.log('Uploading install scripts...');

  console.log('Uploading install-app.sh...');
  const shContent = readFileSync(installAppShPath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'install-app.sh',
    Body: shContent,
    ContentType: 'text/x-shellscript',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }));
  console.log(`  ✓ install-app.sh (${(shContent.length / 1024).toFixed(2)} KB)`);

  console.log('Uploading install-app.ps1...');
  const ps1Content = readFileSync(installAppPs1Path);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'install-app.ps1',
    Body: ps1Content,
    ContentType: 'text/plain',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }));
  console.log(`  ✓ install-app.ps1 (${(ps1Content.length / 1024).toFixed(2)} KB)`);

  console.log('Upload complete!');
}

try {
  if (scriptOnly) {
    await uploadScriptsOnly();
  } else {
    await uploadElectronBuilds(version);
  }
} catch (error) {
  console.error('Upload failed:', error);
  process.exit(1);
}
