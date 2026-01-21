import { createHash } from "crypto";
import { mkdtemp, rm, stat, writeFile, mkdir } from "fs/promises";
import { join, dirname, resolve } from "path";
import { tmpdir } from "os";
import * as tar from "tar";
import JSZip from "jszip";

const MODEL_URL =
  "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip";
const MODEL_MD5 = "09ab50ccd62b674cbaa231b825f9c1cb";
const MODEL_SHA256 =
  "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498";
const MODEL_ARCHIVE_NAME = "vosk-model-small-en-us-0.15.tar.gz";
const MODEL_FOLDER_NAME = "vosk-model-small-en-us-0.15";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
const modelArchivePath = join(
  repoRoot,
  "apps",
  "electron",
  "src",
  "renderer",
  "assets",
  MODEL_ARCHIVE_NAME,
);

function hashBuffer(buffer: Buffer, algorithm: "md5" | "sha256") {
  return createHash(algorithm).update(buffer).digest("hex");
}

async function extractZip(buffer: Buffer, destination: string) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  const normalizedDestination = resolve(destination);

  for (const entry of entries) {
    const entryPath = resolve(normalizedDestination, entry.name);
    if (!entryPath.startsWith(`${normalizedDestination}${pathSeparator()}`) &&
        entryPath !== normalizedDestination) {
      throw new Error(`Invalid zip entry path: ${entry.name}`);
    }

    if (entry.dir) {
      await mkdir(entryPath, { recursive: true });
      continue;
    }

    await mkdir(dirname(entryPath), { recursive: true });
    const contents = await entry.async("nodebuffer");
    await writeFile(entryPath, contents);
  }
}

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

async function ensureModelArchive() {
  try {
    const fileStats = await stat(modelArchivePath);
    if (fileStats.size > 0) {
      return;
    }
  } catch {}

  await mkdir(dirname(modelArchivePath), { recursive: true });

  const workingDirectory = await mkdtemp(join(tmpdir(), "vosk-model-"));
  const zipPath = join(workingDirectory, "model.zip");
  const extractPath = join(workingDirectory, "extract");

  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const md5Hash = hashBuffer(buffer, "md5");
    const sha256Hash = hashBuffer(buffer, "sha256");

    if (md5Hash !== MODEL_MD5 || sha256Hash !== MODEL_SHA256) {
      throw new Error(`Checksum mismatch. md5=${md5Hash} sha256=${sha256Hash}`);
    }

    await writeFile(zipPath, buffer);
    await mkdir(extractPath, { recursive: true });
    await extractZip(buffer, extractPath);

    await tar.c(
      {
        gzip: true,
        file: modelArchivePath,
        cwd: extractPath,
      },
      [MODEL_FOLDER_NAME],
    );
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

void ensureModelArchive();
