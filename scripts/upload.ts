import { S3Client, DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
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
const uploadElectron = process.argv.includes('--electron');
const scriptDir = import.meta.dir;
const repoRoot = dirname(scriptDir);
const buildDir = join(repoRoot, '.build');
const manifestPath = join(buildDir, "upload", 'manifest.json');
const installScriptPath = join(repoRoot, 'scripts', 'install.sh');
const installAppScriptPath = join(repoRoot, 'scripts', 'install-app.sh');
const electronReleaseDir = join(repoRoot, 'apps', 'electron', 'release');
console.log(`Manifest path: ${buildDir}`);

// Read manifest to get version
let manifest: { version: string };
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (error) {
  console.error('Failed to read manifest.json from .build directory');
  console.error('Run the build script first: bun run scripts/build.ts <version>');
  process.exit(1);
}

const version = manifest.version;
console.log(`Uploading version ${version}...`);
if (isLatest) {
  console.log('Will also update /latest folder');
}
if (uploadScript) {
  console.log('Will also upload install.sh');
}
if (uploadElectron) {
  console.log('Will upload Electron DMG files');
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


async function deleteFolder(prefix: string) {
  console.log(`Deleting ${prefix}...`);
  // List all objects with the prefix
  const listResponse = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));

  if (!listResponse.Contents || listResponse.Contents.length === 0) {
    console.log(`  No existing files found`);
    return;
  }

  // Delete all objects
  const deleteResponse = await s3.send(new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: {
      Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
    },
  }));

  console.log(`  Deleted ${deleteResponse.Deleted?.length || 0} files`);
}

async function uploadFolder(prefix: string) {
  console.log(`Uploading to ${prefix}...`);

  const files = readdirSync(join(buildDir, "upload"));

  for (const file of files) {
    const filePath = join(buildDir, "upload", file);
    const content = readFileSync(filePath);
    const key = `${prefix}${file}`;

    // Determine content type
    let contentType = 'application/octet-stream';
    if (file.endsWith('.json')) {
      contentType = 'application/json';
    }

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: content,
      ContentType: contentType,
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));

    console.log(`  ✓ ${key} (${(content.length / 1024 / 1024).toFixed(2)} MB)`);
  }
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

  // Build manifest for Electron
  const electronManifest: {
    version: string;
    build_time: string;
    binaries: Record<string, { url: string; sha256: string; size: number; filename: string }>;
  } = {
    version,
    build_time: new Date().toISOString(),
    binaries: {},
  };

  // Delete existing electron version folder
  const electronVersionPrefix = `electron/${version}/`;
  await deleteFolder(electronVersionPrefix);

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

  // Upload manifest
  const manifestKey = `electron/${version}/manifest.json`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: manifestKey,
    Body: JSON.stringify(electronManifest, null, 2),
    ContentType: 'application/json',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }));
  console.log(`  ✓ ${manifestKey}`);

  // If --latest, update electron/latest
  if (isLatest) {
    console.log('Updating electron/latest...');
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'electron/latest',
      Body: JSON.stringify({ version }),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log('  ✓ electron/latest');
  }

  // Upload install-app.sh if --script is also set
  if (uploadScript) {
    console.log('Uploading install-app.sh...');
    const content = readFileSync(installAppScriptPath);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: 'install-app.sh',
      Body: content,
      ContentType: 'text/x-shellscript',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }));
    console.log(`  ✓ install-app.sh (${(content.length / 1024).toFixed(2)} KB)`);
  }

  console.log('Electron upload complete!');
}

try {
  // Upload Electron builds if --electron flag is set
  if (uploadElectron) {
    await uploadElectronBuilds(version);
  } else {
    // Upload TUI CLI builds (default behavior)
    const versionPrefix = `${version}/`;
    await deleteFolder(versionPrefix);
    await uploadFolder(versionPrefix);
    console.log('');

    // If --latest, also update latest folder
    if (isLatest) {
      const latestPrefix = 'latest';
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: latestPrefix,
        Body: JSON.stringify({ version }),
        ContentType: 'application/json',
      }));
    }

    // If --script, upload install.sh to bucket root
    if (uploadScript) {
      console.log('Uploading install.sh...');
      const content = readFileSync(installScriptPath);
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: 'install.sh',
        Body: content,
        ContentType: 'text/x-shellscript',
        CacheControl: 'no-cache, no-store, must-revalidate',
      }));
      console.log(`  ✓ install.sh (${(content.length / 1024).toFixed(2)} KB)`);
    }
  }

  console.log('Upload complete!');
} catch (error) {
  console.error('Upload failed:', error);
  process.exit(1);
}
