import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import { getVideoStudioSource } from '@craft-agent/shared/sources';
import { validateRunnerVideoProject, type RunnerVideoProject, type VideoMediaType, type VideoTrackType } from '@craft-agent/shared/video';
import { writeOutputManifest, type OutputAsset, type OutputManifest } from '@craft-agent/shared/outputs';
import type { RpcServer } from '@craft-agent/server-core/transport';
import { requestClientOpenFileDialog } from '@craft-agent/server-core/transport';
import { sanitizeFilename } from '@craft-agent/server-core/handlers';
import type { HandlerDeps } from '../handler-deps';
import { OutputService, pushOutputsUpdated } from '../../outputs/OutputService';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.videoStudio.IMPORT_MEDIA,
  RPC_CHANNELS.videoStudio.EXPORT,
  RPC_CHANNELS.videoStudio.RUN_AGENT,
] as const;

interface VideoStudioImportResult {
  ok: boolean;
  outputId: string;
  imported: Array<{ mediaId: string; assetId: string; label: string; type: string; path: string }>;
  skipped: number;
  projectAssetId: string;
}

interface VideoStudioExportResult {
  ok: boolean;
  outputId: string;
  assetId: string;
  receiptAssetId: string;
  outputPath: string;
  receiptPath: string;
  rendered: boolean;
}

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return workspace.rootPath;
}

function assertLocalWorkspace(workspaceId: string, action: string): void {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (workspace?.remoteServer) throw new Error(`${action} is not available for remote workspaces`);
}

function serviceFor(server: RpcServer): OutputService {
  return new OutputService({
    getWorkspaceRootPath: resolveRootPath,
    emitOutputsUpdated: (workspaceId) => pushOutputsUpdated(server, workspaceId),
  });
}

function videoProjectAsset(output: OutputManifest): OutputAsset {
  const asset = output.assets.find((item) => item.path.toLowerCase().endsWith('.runner-video.json'));
  if (!asset) throw new Error(`Output "${output.id}" does not include a Video Studio project file.`);
  return asset;
}

function readProject(path: string): RunnerVideoProject {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as RunnerVideoProject;
  const validation = validateRunnerVideoProject(parsed);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new Error(first ? `Invalid video project: ${first.path} ${first.message}` : 'Invalid video project.');
  }
  return parsed;
}

function writeProject(path: string, project: RunnerVideoProject): void {
  const validation = validateRunnerVideoProject(project);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new Error(first ? `Invalid video project: ${first.path} ${first.message}` : 'Invalid video project.');
  }
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8');
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function fileMetadata(path: string): Pick<OutputAsset, 'mimeType' | 'sizeBytes' | 'sha256'> {
  const stats = statSync(path);
  const buffer = readFileSync(path);
  return {
    mimeType: mimeTypeForPath(path),
    sizeBytes: stats.size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

function inferMediaType(path: string): VideoMediaType {
  const ext = extname(path).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp'].includes(ext)) return 'image';
  if (['.srt', '.vtt'].includes(ext)) return 'caption';
  if (ext === '.svg') return 'svg';
  if (ext === '.json' || ext === '.lottie') return 'lottie';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'unknown';
}

function isImportableMediaType(type: VideoMediaType): boolean {
  return type === 'video' || type === 'audio' || type === 'image';
}

function collectImportableFiles(paths: string[], maxFiles = 500): { files: string[]; skipped: number } {
  const files: string[] = [];
  let skipped = 0;
  const visit = (path: string): void => {
    if (files.length >= maxFiles) {
      skipped += 1;
      return;
    }
    if (!existsSync(path)) {
      skipped += 1;
      return;
    }
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
      return;
    }
    if (!stats.isFile()) {
      skipped += 1;
      return;
    }
    if (!isImportableMediaType(inferMediaType(path))) {
      skipped += 1;
      return;
    }
    files.push(path);
  };
  for (const path of paths) visit(path);
  return { files, skipped };
}

function mimeTypeForPath(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json';
  return undefined;
}

function trackTypeForMedia(mediaType: VideoMediaType): VideoTrackType {
  if (mediaType === 'audio') return 'audio';
  if (mediaType === 'caption') return 'caption';
  if (mediaType === 'image') return 'image';
  return 'video';
}

function preferredTrackId(mediaType: VideoMediaType): string {
  if (mediaType === 'audio') return 'audio-main';
  if (mediaType === 'caption') return 'captions-main';
  return 'video-main';
}

function ensureTrack(project: RunnerVideoProject, mediaType: VideoMediaType): RunnerVideoProject['timeline']['tracks'][number] {
  const id = preferredTrackId(mediaType);
  const found = project.timeline.tracks.find((track) => track.id === id);
  if (found) return found;
  const created = { id, type: trackTypeForMedia(mediaType), label: mediaType === 'audio' ? 'Audio' : mediaType === 'caption' ? 'Captions' : 'Video', clips: [] };
  project.timeline.tracks.push(created);
  return created;
}

function defaultClipDuration(mediaType: VideoMediaType): number {
  if (mediaType === 'image') return 3000;
  if (mediaType === 'caption') return 3000;
  if (mediaType === 'audio') return 5000;
  return 5000;
}

function addVersion(project: RunnerVideoProject, summary: string, actor: 'user' | 'agent' | 'system' = 'user'): string {
  const now = new Date().toISOString();
  const versionId = randomUUID();
  project.updatedAt = now;
  project.versions.push({ id: versionId, createdAt: now, summary, actor });
  return versionId;
}

function relativeAssetPath(root: string, outputId: string, absolutePath: string): string {
  return relative(join(root, 'outputs', outputId), absolutePath).replace(/\\/g, '/');
}

function videoStudioCli(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  const root = workspace?.rootPath ?? process.cwd();
  const source = getVideoStudioSource(workspaceId, root);
  return join(source.folderPath, 'bin', 'video-studio.mjs');
}

export function registerVideoStudioHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.videoStudio.IMPORT_MEDIA,
    async (ctx, workspaceId: string, outputId: string, options?: { mode?: 'files' | 'folder' }): Promise<VideoStudioImportResult> => {
      assertLocalWorkspace(workspaceId, 'Import Video Studio media');
      const mode = options?.mode === 'folder' ? 'folder' : 'files';
      const result = await requestClientOpenFileDialog(server, ctx.clientId, {
        properties: mode === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
        filters: [
          { name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: true, outputId, imported: [], skipped: 0, projectAssetId: '' };
      }

      const service = serviceFor(server);
      const root = resolveRootPath(workspaceId);
      const output = service.get(workspaceId, outputId);
      if (!output) throw new Error(`Output not found: ${outputId}`);
      const projectAsset = videoProjectAsset(output);
      const projectPath = service.resolveAssetPath(workspaceId, outputId, projectAsset.path);
      const project = readProject(projectPath);
      const mediaDir = service.resolveAssetPath(workspaceId, outputId, 'media/.keep');
      mkdirSync(dirname(mediaDir), { recursive: true });

      const imported: VideoStudioImportResult['imported'] = [];
      const nextAssets = [...output.assets];
      const collected = collectImportableFiles(result.filePaths);
      for (const sourcePath of collected.files) {
        const mediaId = randomUUID();
        const mediaType = inferMediaType(sourcePath);
        const safeName = sanitizeFilename(basename(sourcePath)) || `media${extname(sourcePath)}`;
        const assetPath = `media/${mediaId}-${safeName}`;
        const targetPath = service.resolveAssetPath(workspaceId, outputId, assetPath);
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, targetPath);

        const label = basename(sourcePath);
        project.media.push({
          id: mediaId,
          type: mediaType,
          label,
          path: targetPath,
          mimeType: mimeTypeForPath(targetPath),
          source: { kind: 'user-import' },
        });
        const track = ensureTrack(project, mediaType);
        const startMs = Math.max(0, project.timeline.durationMs || 0);
        const durationMs = defaultClipDuration(mediaType);
        track.clips.push({
          id: randomUUID(),
          mediaId,
          type: mediaType === 'audio' ? 'audio' : mediaType === 'caption' ? 'caption' : mediaType === 'image' ? 'image' : 'video',
          startMs,
          durationMs,
          label,
        });
        project.timeline.durationMs = Math.max(project.timeline.durationMs || 0, startMs + durationMs);
        const asset: OutputAsset = {
          id: `video-media-${mediaId}`,
          label,
          role: 'attachment',
          path: assetPath,
          ...fileMetadata(targetPath),
        };
        nextAssets.push(asset);
        imported.push({ mediaId, assetId: asset.id, label, type: mediaType, path: targetPath });
      }

      if (imported.length > 0) {
        addVersion(project, `Imported ${imported.length} media file${imported.length === 1 ? '' : 's'}`);
        writeProject(projectPath, project);
        writeOutputManifest(root, {
          ...output,
          updatedAt: new Date().toISOString(),
          assets: nextAssets,
        });
        pushOutputsUpdated(server, workspaceId);
      }

      return { ok: true, outputId, imported, skipped: collected.skipped, projectAssetId: projectAsset.id };
    },
  );

  server.handle(
    RPC_CHANNELS.videoStudio.EXPORT,
    async (_ctx, workspaceId: string, outputId: string, preset = 'simple-mp4'): Promise<VideoStudioExportResult> => {
      assertLocalWorkspace(workspaceId, 'Export Video Studio project');
      const service = serviceFor(server);
      const root = resolveRootPath(workspaceId);
      const output = service.get(workspaceId, outputId);
      if (!output) throw new Error(`Output not found: ${outputId}`);
      const projectAsset = videoProjectAsset(output);
      const projectPath = service.resolveAssetPath(workspaceId, outputId, projectAsset.path);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const renderPath = service.resolveAssetPath(workspaceId, outputId, `renders/${stamp}.mp4`);
      mkdirSync(dirname(renderPath), { recursive: true });
      const cliPath = videoStudioCli(workspaceId);
      if (!existsSync(cliPath)) throw new Error(`Video Studio CLI not found: ${cliPath}`);
      const child = spawnSync('node', [cliPath, 'export', projectPath, '--preset', preset, '--out', renderPath, '--json'], {
        encoding: 'utf-8',
        cwd: dirname(projectPath),
      });
      if (child.status !== 0) {
        throw new Error(child.stderr || child.stdout || 'Video Studio export failed.');
      }
      const receiptPath = `${renderPath}.receipt.json`;
      const renderAssetPath = relativeAssetPath(root, outputId, renderPath);
      const receiptAssetPath = relativeAssetPath(root, outputId, receiptPath);
      const assetId = `video-render-${stamp}`;
      const receiptAssetId = `video-render-receipt-${stamp}`;
      const renderAsset: OutputAsset = {
        id: assetId,
        label: basename(renderPath),
        role: 'primary',
        path: renderAssetPath,
        ...fileMetadata(renderPath),
      };
      const receiptAsset: OutputAsset = {
        id: receiptAssetId,
        label: basename(receiptPath),
        role: 'supporting',
        path: receiptAssetPath,
        ...fileMetadata(receiptPath),
      };
      writeOutputManifest(root, {
        ...output,
        kind: 'video',
        status: 'published',
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        summary: `Video Studio export rendered to ${basename(renderPath)}.`,
        primary: renderAsset,
        preview: { mode: 'video', assetId },
        assets: [
          ...output.assets.filter((asset) => asset.id !== assetId && asset.id !== receiptAssetId),
          renderAsset,
          receiptAsset,
        ],
      });
      pushOutputsUpdated(server, workspaceId);
      return { ok: true, outputId, assetId, receiptAssetId, outputPath: renderPath, receiptPath, rendered: true };
    },
  );

  server.handle(
    RPC_CHANNELS.videoStudio.RUN_AGENT,
    async (_ctx, workspaceId: string, outputId: string, prompt: string) => {
      assertLocalWorkspace(workspaceId, 'Run Video Studio agent');
      if (!prompt?.trim()) throw new Error('Agent prompt is required.');
      return {
        ok: true,
        outputId,
        status: 'not-implemented' as const,
        message: 'Video Studio agent command endpoint is registered; session handoff is the next implementation phase.',
      };
    },
  );
}
