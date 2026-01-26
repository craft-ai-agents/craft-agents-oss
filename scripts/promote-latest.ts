/**
 * Promote a versioned release to the `electron/latest/` endpoint.
 *
 * This script copies all files from `electron/{version}/` to `electron/latest/`
 * using S3 CopyObject (no re-download needed), updates the version pointer JSON,
 * and uploads the install scripts.
 *
 * Usage:
 *   bun run scripts/promote-latest.ts --version 0.2.32
 *
 * This is the second step in the release process:
 *   1. release.yml builds and uploads to electron/{version}/ (automatic)
 *   2. promote.yml copies to electron/latest/ (manual, after testing)
 *
 * Once promoted, all users receive the update via electron-updater.
 */

import { S3Client, ListObjectsV2Command, CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';

const BUCKET = 'agents-craft-do';

if (!process.env.S3_VERSIONS_BUCKET_ENDPOINT || !process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID || !process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials');
  process.exit(1);
}

// Parse --version flag from CLI args
const versionFlagIndex = process.argv.indexOf('--version');
const version = versionFlagIndex !== -1 ? process.argv[versionFlagIndex + 1] : null;

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: bun run scripts/promote-latest.ts --version X.Y.Z');
  process.exit(1);
}

const uploadScript = process.argv.includes('--script');

const scriptDir = import.meta.dir;
const repoRoot = dirname(scriptDir);
const installAppShPath = join(repoRoot, 'scripts', 'install-app.sh');
const installAppPs1Path = join(repoRoot, 'scripts', 'install-app.ps1');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_VERSIONS_BUCKET_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY,
  },
});

console.log(`Promoting v${version} to electron/latest/...`);
console.log('');

// List all objects under electron/{version}/
const listResponse = await s3.send(new ListObjectsV2Command({
  Bucket: BUCKET,
  Prefix: `electron/${version}/`,
}));

const objects = listResponse.Contents;
if (!objects || objects.length === 0) {
  console.error(`✗ No files found at electron/${version}/`);
  console.error('  Has the release workflow uploaded this version?');
  process.exit(1);
}

console.log(`Found ${objects.length} files in electron/${version}/`);

// Copy each file from electron/{version}/ to electron/latest/
// This uses server-side copy — no data is downloaded/re-uploaded.
for (const obj of objects) {
  if (!obj.Key) continue;

  const filename = obj.Key.replace(`electron/${version}/`, '');
  const latestKey = `electron/latest/${filename}`;

  console.log(`  Copying ${filename} → ${latestKey}`);

  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${obj.Key}`,
    Key: latestKey,
    // Reset cache headers on the copy so clients always get fresh latest
    CacheControl: 'no-cache, no-store, must-revalidate',
    MetadataDirective: 'REPLACE',
  }));

  console.log(`  ✓ ${latestKey}`);
}

// Update the version pointer JSON (used by CLI install scripts to discover the latest version)
await s3.send(new PutObjectCommand({
  Bucket: BUCKET,
  Key: 'electron/latest',
  Body: JSON.stringify({ version }),
  ContentType: 'application/json',
  CacheControl: 'no-cache, no-store, must-revalidate',
}));
console.log('  ✓ electron/latest (version pointer)');

// Upload install scripts if --script flag is set
if (uploadScript) {
  console.log('');
  console.log('Uploading install scripts...');

  const shContent = readFileSync(installAppShPath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'install-app.sh',
    Body: shContent,
    ContentType: 'text/x-shellscript',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }));
  console.log(`  ✓ install-app.sh (${(shContent.length / 1024).toFixed(2)} KB)`);

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

console.log('');
console.log(`✓ Promoted v${version} to electron/latest/`);
console.log('  All users will now receive this version via auto-update.');
