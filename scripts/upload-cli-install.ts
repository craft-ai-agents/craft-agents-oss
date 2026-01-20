import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';

const BUCKET = 'agents-craft-do';

if (!process.env.S3_VERSIONS_BUCKET_ENDPOINT || !process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID || !process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials');
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

const scriptDir = import.meta.dir;
const repoRoot = dirname(scriptDir);
const installShPath = join(repoRoot, 'scripts', 'install.sh');

async function uploadInstallScript() {
  console.log('Uploading CLI install script...\n');

  const installShContent = readFileSync(installShPath);

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'cli/install.sh',
    Body: installShContent,
    ContentType: 'text/x-shellscript',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }));

  console.log(`✓ cli/install.sh (${(installShContent.length / 1024).toFixed(2)} KB)`);
  console.log('\nUpload complete!');
  console.log('\nNew URL: https://agents.craft.do/cli/install.sh');
  console.log('\nNext step: Deploy the CloudFlare worker:');
  console.log('  cd workers/agents-router');
  console.log('  npx wrangler deploy');
}

try {
  await uploadInstallScript();
} catch (error) {
  console.error('Upload failed:', error);
  process.exit(1);
}
