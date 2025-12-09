import { exists, mkdir, chmod, writeFile, symlink } from "fs/promises";
import { getLatestVersion, getManifest } from "./manifest";
import { createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";

export async function downloadBinary(params: { url: string, sha256: string }): Promise<ArrayBuffer | null> {
  const { url, sha256 } = params;
  const response = await fetch(url);
  console.log(`Fetching binary from: ${url}`);
  const data = await response.arrayBuffer();
  const buffer = Buffer.from(data);
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (hash !== sha256) {
    console.error(`Checksum mismatch: ${hash} !== ${sha256}`);
    console.error('Checksum mismatch');
    return null;
  }
  return data;
}

export async function ensureDirectory(path: string): Promise<void> {
  if (!await exists(path)) {
    await mkdir(path, { recursive: true });
  }
}

export async function installBinary(params: { binaryData: ArrayBuffer, version: string }): Promise<void> {
  const { binaryData, version } = params;
  const actualDirectory = join(homedir(), '.local', 'share', 'craft', 'versions');
  const actualPath = join(actualDirectory, version);
  const symlinkDirectory = join(homedir(), '.local', 'bin', 'craft');
  const symlinkPath = join(symlinkDirectory, 'craft');

  await ensureDirectory(actualDirectory);
  await ensureDirectory(symlinkDirectory);

  await writeFile(actualPath, Buffer.from(binaryData));
  await chmod(actualPath, '755');
  await symlink(actualPath, symlinkPath);
}

export async function install(version: string | null): Promise<VersionInstallResult> {
  if (version === 'latest' || version == null) {
    version = await getLatestVersion();
  }
  if (version == null) {
    console.error('Failed to get the latest version');
    return { success: false, error: 'Failed to get the latest version' };
  }
  console.log(`Installing version: ${version}`);

  const manifest = await getManifest(version);
  if (manifest == null) {
    console.error('Failed to get the manifest');
    return { success: false, error: 'Failed to get the manifest' };
  }

  const platform = `${process.platform}-${process.arch}`;
  const binary = manifest.binaries[platform];
  if (binary == null) {
    console.error(`No binary found for platform: ${platform}`);
    return { success: false, error: `No binary found for platform: ${platform}` };
  }
  const binaryUrl = binary.url;
  const binarySha256 = binary.sha256;
  console.log(`Binary URL: ${binaryUrl}`);
  console.log(`Binary SHA256: ${binarySha256}`);

  const binaryData = await downloadBinary({ url: binaryUrl, sha256: binarySha256 });
  if (binaryData == null) {
    console.error('Failed to download binary');
    return { success: false, error: 'Failed to download binary' };
  }
  await installBinary({ binaryData, version });

  return { success: true };
}

type VersionInstallResult = {
  success: true;
} | {
  success: false;
  error: string;
};