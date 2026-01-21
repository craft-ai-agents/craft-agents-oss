import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

const BUCKET = 'agents-craft-do';
if (!process.env.S3_VERSIONS_BUCKET_ENDPOINT || !process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID || !process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials');
  process.exit(1);
}

const isLatest = process.argv.includes('--latest');
const uploadScript = process.argv.includes('--script');
const scriptDir = import.meta.dir;
const repoRoot = dirname(scriptDir);
const installAppShPath = join(repoRoot, 'scripts', 'install-app.sh');
const installAppPs1Path = join(repoRoot, 'scripts', 'install-app.ps1');
const electronReleaseDir = join(repoRoot, 'apps', 'electron', 'release');

// Get version from package.json
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
const version = packageJson.version;

console.log(`Uploading Electron version ${version}...`);
if (isLatest) {
  console.log('Will also update electron/latest');
}
if (uploadScript) {
  console.log('Will also upload install scripts (install-app.sh, install-app.ps1)');
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


type ManifestBinary = { url: string; sha256: string; size: number; filename: string };
type Manifest = {
  version: string;
  build_time: string;
  binaries: Record<string, ManifestBinary>;
};

/**
 * Fetch existing manifest from S3, or return null if it doesn't exist
 */
async function fetchExistingManifest(version: string): Promise<Manifest | null> {
  const manifestKey = `electron/${version}/manifest.json`;
  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: manifestKey,
    }));
    const body = await response.Body?.transformToString();
    if (body) {
      console.log(`  Found existing manifest for ${version}`);
      return JSON.parse(body) as Manifest;
    }
  } catch (error: unknown) {
    // NoSuchKey error means manifest doesn't exist yet
    if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey') {
      console.log(`  No existing manifest for ${version}, creating new one`);
    } else {
      console.warn(`  Warning: Failed to fetch existing manifest:`, error);
    }
  }
  return null;
}

function computeSha256(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Detect platform from installer filename
 * Returns platform key (e.g., 'darwin-arm64', 'win32-x64', 'linux-x64') or null
 */
function detectPlatformFromFilename(filename: string): string | null {
  // macOS DMG
  if (filename.endsWith('.dmg')) {
    if (filename.includes('arm64')) return 'darwin-arm64';
    if (filename.includes('x64') || filename.includes('x86_64')) return 'darwin-x64';
  }
  // Windows NSIS installer
  if (filename.endsWith('.exe')) {
    // Currently only x64 Windows builds
    if (filename.includes('arm64')) return 'win32-arm64';
    return 'win32-x64';
  }
  // Linux AppImage
  if (filename.endsWith('.AppImage')) {
    if (filename.includes('arm64')) return 'linux-arm64';
    return 'linux-x64';
  }
  return null;
}

/**
 * Get content type for installer file
 */
function getContentType(filename: string): string {
  if (filename.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (filename.endsWith('.exe')) return 'application/x-msdownload';
  if (filename.endsWith('.AppImage')) return 'application/x-executable';
  return 'application/octet-stream';
}

async function uploadElectronBuilds(version: string) {
  console.log('Uploading Electron builds...');

  // Find installer files in the release directory
  if (!existsSync(electronReleaseDir)) {
    console.error(`  ✗ Electron release directory not found: ${electronReleaseDir}`);
    console.error('  Run: bun run electron:dist:mac (or :win, :linux)');
    process.exit(1);
  }

  const files = readdirSync(electronReleaseDir);
  // Support all installer types: .dmg (macOS), .exe (Windows NSIS), .AppImage (Linux)
  const installerFiles = files.filter(f =>
    f.endsWith('.dmg') || f.endsWith('.exe') || f.endsWith('.AppImage')
  );

  if (installerFiles.length === 0) {
    console.error('  ✗ No installer files found in release directory');
    console.error('  Run: bun run electron:dist:mac (or :win, :linux)');
    process.exit(1);
  }

  // Fetch existing manifest to merge with (preserves other platforms' binaries)
  const existingManifest = await fetchExistingManifest(version);

  // Build manifest - start with existing binaries or empty
  const electronManifest: Manifest = {
    version,
    build_time: new Date().toISOString(),
    binaries: existingManifest?.binaries || {},
  };

  console.log(`  Existing platforms: ${Object.keys(electronManifest.binaries).join(', ') || 'none'}`);

  // Upload each installer file
  for (const installerFile of installerFiles) {
    const filePath = join(electronReleaseDir, installerFile);
    const stats = statSync(filePath);
    const content = readFileSync(filePath);
    const sha256 = computeSha256(filePath);

    // Determine platform from filename
    const platform = detectPlatformFromFilename(installerFile);
    if (!platform) {
      console.warn(`  ! Skipping unknown installer: ${installerFile}`);
      continue;
    }

    const key = `electron/${version}/${installerFile}`;
    const contentType = getContentType(installerFile);

    console.log(`  Uploading ${installerFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB) [${platform}]...`);

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: content,
      ContentType: contentType,
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));

    console.log(`  ✓ ${key}`);

    // Add to manifest
    electronManifest.binaries[platform] = {
      url: `https://agents.craft.do/electron/${version}/${installerFile}`,
      sha256,
      size: stats.size,
      filename: installerFile,
    };
  }

  // Upload merged manifest
  const manifestKey = `electron/${version}/manifest.json`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: manifestKey,
    Body: JSON.stringify(electronManifest, null, 2),
    ContentType: 'application/json',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }));
  console.log(`  ✓ ${manifestKey}`);
  console.log(`  Final platforms in manifest: ${Object.keys(electronManifest.binaries).join(', ')}`);

  // If --latest, update electron/latest and copy files to /latest/ folder
  if (isLatest) {
    console.log('Updating electron/latest...');

    // Update version pointer (for install scripts)
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'electron/latest',
      Body: JSON.stringify({ version }),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log('  ✓ electron/latest');

    // Copy all installers to /latest/ folder for direct download URLs
    // This enables stable URLs like: https://agents.craft.do/electron/latest/Craft-Agent-arm64.dmg
    console.log('Copying installers to electron/latest/...');
    for (const installerFile of installerFiles) {
      const filePath = join(electronReleaseDir, installerFile);
      const content = readFileSync(filePath);
      const contentType = getContentType(installerFile);
      const latestKey = `electron/latest/${installerFile}`;

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: latestKey,
        Body: content,
        ContentType: contentType,
        CacheControl: 'no-cache, no-store, must-revalidate',
      }));
      console.log(`  ✓ ${latestKey}`);
    }

    // Also copy manifest to /latest/
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'electron/latest/manifest.json',
      Body: JSON.stringify(electronManifest, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log('  ✓ electron/latest/manifest.json');
  }

  // Upload install scripts if --script is set
  if (uploadScript) {
    // macOS/Linux bash script
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

    // Windows PowerShell script
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

try {
  await uploadElectronBuilds(version);
} catch (error) {
  console.error('Upload failed:', error);
  process.exit(1);
}
