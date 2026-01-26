import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

const BUCKET = 'agents-craft-do';

if (!process.env.S3_VERSIONS_BUCKET_ENDPOINT || !process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID || !process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials. Set S3_VERSIONS_BUCKET_ENDPOINT, S3_VERSIONS_BUCKET_ACCESS_KEY_ID, S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_VERSIONS_BUCKET_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY,
  },
});

const VERSION = process.argv[2] || '0.2.31';

async function upload() {
  // Fetch the manifest for the specified version from S3
  const manifestKey = `electron/${VERSION}/manifest.json`;
  console.log(`Fetching manifest from S3: ${manifestKey}...`);

  const getResponse = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: manifestKey,
  }));

  const manifestContent = await getResponse.Body?.transformToString();
  if (!manifestContent) {
    throw new Error(`Failed to fetch manifest: empty response`);
  }
  console.log(`  ✓ Fetched manifest for v${VERSION}`);

  // Upload to latest
  console.log('Uploading electron/latest/manifest.json...');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'electron/latest/manifest.json',
    Body: manifestContent,
    ContentType: 'application/json',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }));
  console.log('  ✓ electron/latest/manifest.json');

  console.log(`Done! /latest now points to v${VERSION}`);
}

upload().catch(err => {
  console.error('Upload failed:', err);
  process.exit(1);
});
