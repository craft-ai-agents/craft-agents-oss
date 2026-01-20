import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

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

async function listBucket(prefix?: string) {
  console.log(`Listing bucket: ${BUCKET}${prefix ? ` (prefix: ${prefix})` : ''}\n`);

  let continuationToken: string | undefined;
  let totalObjects = 0;

  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));

    if (response.Contents) {
      for (const obj of response.Contents) {
        const sizeKB = obj.Size ? (obj.Size / 1024).toFixed(2) : '0';
        const lastModified = obj.LastModified?.toISOString().split('T')[0] || 'unknown';
        console.log(`${obj.Key?.padEnd(60)} ${sizeKB.padStart(10)} KB  ${lastModified}`);
        totalObjects++;
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log(`\nTotal objects: ${totalObjects}`);
}

const prefix = process.argv[2];
try {
  await listBucket(prefix);
} catch (error) {
  console.error('Failed to list bucket:', error);
  process.exit(1);
}
