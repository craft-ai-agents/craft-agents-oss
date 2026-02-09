/**
 * Upload release artifacts to Cloudflare R2 (S3-compatible).
 *
 * Usage:
 *   bun run scripts/upload.ts --electron          # Upload release binaries + YML manifests
 *   bun run scripts/upload.ts --latest            # Upload {"version":"X"} to key "latest"
 *   bun run scripts/upload.ts --script            # Upload install-app.sh and install-app.ps1
 *   bun run scripts/upload.ts --electron --latest --script  # All at once
 *
 * Environment variables (from .env):
 *   S3_VERSIONS_BUCKET_ENDPOINT       - R2 S3-compatible endpoint
 *   S3_VERSIONS_BUCKET_ACCESS_KEY_ID  - R2 API token access key
 *   S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY - R2 API token secret key
 *   S3_VERSIONS_BUCKET_NAME           - Bucket name (default: g4os-releases)
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────

const ELECTRON_DIR = join(import.meta.dir, '..', 'apps', 'electron');
const SCRIPTS_DIR = join(import.meta.dir);
const ROOT_DIR = join(import.meta.dir, '..');

const endpoint = process.env.S3_VERSIONS_BUCKET_ENDPOINT;
const accessKeyId = process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY;
const bucket = process.env.S3_VERSIONS_BUCKET_NAME || 'g4os-releases';

if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.error('Missing S3/R2 credentials. Set S3_VERSIONS_BUCKET_ENDPOINT, S3_VERSIONS_BUCKET_ACCESS_KEY_ID, S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  region: 'auto',
  forcePathStyle: true,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.json': 'application/json',
  '.dmg': 'application/octet-stream',
  '.zip': 'application/zip',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.AppImage': 'application/octet-stream',
  '.sh': 'text/x-shellscript',
  '.ps1': 'text/plain',
};

const NO_CACHE_EXTENSIONS = new Set(['.yml', '.yaml', '.json', '.sh', '.ps1']);

function getContentType(filename: string): string {
  const ext = extname(filename);
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function getCacheControl(filename: string): string {
  const ext = extname(filename);
  if (NO_CACHE_EXTENSIONS.has(ext)) return 'no-cache';
  return 'public, max-age=31536000, immutable';
}

/** Upload a file to R2 */
async function upload(key: string, body: Buffer | string, contentType: string, cacheControl: string): Promise<void> {
  const bodyBuffer = typeof body === 'string' ? Buffer.from(body) : body;
  console.log(`  Uploading: ${key} (${(bodyBuffer.length / 1024).toFixed(1)} KB, ${contentType})`);

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bodyBuffer,
    ContentType: contentType,
    CacheControl: cacheControl,
  }));
}

/** Read version from apps/electron/package.json */
function getVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ELECTRON_DIR, 'package.json'), 'utf-8'));
  return pkg.version;
}

// ─── Upload modes ────────────────────────────────────────────────────────────

/** Upload release artifacts from apps/electron/release/ */
async function uploadElectron(): Promise<void> {
  const version = getVersion();
  const releaseDir = join(ELECTRON_DIR, 'release');

  if (!existsSync(releaseDir)) {
    console.error(`Release directory not found: ${releaseDir}`);
    console.error('Run the build first: bash apps/electron/scripts/build-dmg.sh arm64');
    process.exit(1);
  }

  const extensions = new Set(['.yml', '.dmg', '.zip', '.blockmap', '.AppImage', '.exe']);
  const files = readdirSync(releaseDir).filter((f) => {
    const ext = extname(f);
    return extensions.has(ext);
  });

  if (files.length === 0) {
    console.error('No release artifacts found in', releaseDir);
    process.exit(1);
  }

  console.log(`\nUploading ${files.length} release artifacts (v${version}):`);

  for (const file of files) {
    const filePath = join(releaseDir, file);
    const body = readFileSync(filePath);
    const key = file; // Flat R2 key (filename only)
    await upload(key, body, getContentType(file), getCacheControl(file));
  }

  // Upload versioned manifest
  const manifestPath = join(ROOT_DIR, '.build', 'upload', 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = readFileSync(manifestPath);
    const manifestKey = `${version}/manifest.json`;
    await upload(manifestKey, manifest, 'application/json', 'no-cache');
  } else {
    console.warn(`  Warning: ${manifestPath} not found, skipping versioned manifest`);
  }

  console.log('Done uploading release artifacts.');
}

/** Upload {"version":"X"} to key "latest" */
async function uploadLatest(): Promise<void> {
  const version = getVersion();
  const body = JSON.stringify({ version });
  console.log(`\nUploading latest version pointer: ${version}`);
  await upload('latest', body, 'application/json', 'no-cache');
  console.log('Done.');
}

/** Upload install scripts */
async function uploadScripts(): Promise<void> {
  console.log('\nUploading install scripts:');

  const shPath = join(SCRIPTS_DIR, 'install-app.sh');
  if (existsSync(shPath)) {
    await upload('install-app.sh', readFileSync(shPath), 'text/x-shellscript', 'no-cache');
  } else {
    console.warn(`  Warning: ${shPath} not found`);
  }

  const ps1Path = join(SCRIPTS_DIR, 'install-app.ps1');
  if (existsSync(ps1Path)) {
    await upload('install-app.ps1', readFileSync(ps1Path), 'text/plain', 'no-cache');
  } else {
    console.warn(`  Warning: ${ps1Path} not found`);
  }

  console.log('Done uploading install scripts.');
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));

if (args.size === 0) {
  console.log('Usage: bun run scripts/upload.ts [--electron] [--latest] [--script]');
  console.log('  --electron  Upload release binaries + YML manifests from apps/electron/release/');
  console.log('  --latest    Upload version pointer to key "latest"');
  console.log('  --script    Upload install-app.sh and install-app.ps1');
  process.exit(0);
}

if (args.has('--electron')) await uploadElectron();
if (args.has('--latest')) await uploadLatest();
if (args.has('--script')) await uploadScripts();

console.log('\nAll uploads complete.');
