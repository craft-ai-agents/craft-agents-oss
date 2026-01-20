import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

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

async function downloadFile(key: string) {
  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));

    const body = await response.Body?.transformToString();
    if (body) {
      console.log(body);
    }
  } catch (error) {
    console.error('Failed to download:', error);
    process.exit(1);
  }
}

const key = process.argv[2];
if (!key) {
  console.error('Usage: bun run scripts/download-s3.ts <key>');
  process.exit(1);
}

await downloadFile(key);
