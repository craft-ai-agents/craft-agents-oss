import { S3Client, ListObjectsV2Command, CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

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

async function migrateCLIFiles() {
  console.log('Migrating CLI files to /cli prefix...\n');

  // List all objects in the bucket
  let continuationToken: string | undefined;
  const filesToMigrate: string[] = [];

  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));

    if (response.Contents) {
      for (const obj of response.Contents) {
        const key = obj.Key;
        if (!key) continue;

        // Skip files already under electron/ or cli/
        if (key.startsWith('electron/') || key.startsWith('cli/')) continue;

        // Migrate version directories (e.g., 1.0.18/darwin-arm64.tar.gz)
        // Migrate install.sh and latest
        if (/^\d+\.\d+\.\d+\//.test(key) || key === 'install.sh' || key === 'latest') {
          filesToMigrate.push(key);
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log(`Found ${filesToMigrate.length} files to migrate:\n`);

  // Copy each file to cli/ prefix
  for (const oldKey of filesToMigrate) {
    const newKey = `cli/${oldKey}`;

    try {
      // Copy object to new location
      await s3.send(new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${oldKey}`,
        Key: newKey,
      }));

      console.log(`✓ ${oldKey} → ${newKey}`);
    } catch (error) {
      console.error(`✗ Failed to copy ${oldKey}:`, error);
    }
  }

  console.log(`\nMigration complete! Migrated ${filesToMigrate.length} files.`);
  console.log('\nNew CLI structure:');
  console.log('  /cli/install.sh');
  console.log('  /cli/latest');
  console.log('  /cli/{version}/{platform}.tar.gz');
  console.log('\nOld files are still in place. Delete them manually if migration was successful.');
}

try {
  await migrateCLIFiles();
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}
