import { z } from 'zod';
import type { OwnerProfile } from '@archstudio/core';

export const OwnerProfileIdentitySchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()),
  locale: z.string().min(1),
  timezone: z.string().min(1),
});

export const OwnerProfileCommunicationSchema = z.object({
  tone: z.string().min(1),
  verbosity: z.number().int().min(1).max(5),
  bannedPhrases: z.array(z.string()),
});

export const OwnerProfileExecutionSchema = z.object({
  defaultMode: z.enum(['explore', 'owner-auto', 'unrestricted']),
  askOnlyWhen: z.array(z.string()),
});

export const OwnerProfilePathsSchema = z.object({
  allowedRoots: z.array(z.string()),
  artifactRoot: z.string(),
  backupRoot: z.string(),
});

export const OwnerProfilePrivacySchema = z.object({
  telemetry: z.boolean(),
  cloudMemory: z.boolean(),
  redactSecretsInLogs: z.boolean(),
});

export const OwnerProfileSchema = z.object({
  identity: OwnerProfileIdentitySchema,
  communication: OwnerProfileCommunicationSchema,
  execution: OwnerProfileExecutionSchema,
  paths: OwnerProfilePathsSchema,
  privacy: OwnerProfilePrivacySchema,
  updatedAt: z.number().optional(),
});

export const DEFAULT_OWNER_PROFILE: OwnerProfile = {
  identity: {
    name: 'Skobez',
    aliases: ['Richard', 'Skobez'],
    locale: 'en',
    timezone: 'UTC',
  },
  communication: {
    tone: 'direct and technical, never apologetic or deferential',
    verbosity: 3,
    bannedPhrases: [
      "I'm sorry",
      "I apologize",
      "As an AI",
      "programmed to",
      "how can I help you today",
    ],
  },
  execution: {
    defaultMode: 'owner-auto',
    askOnlyWhen: [
      'filesystem-write',
      'config-write',
      'memory-write',
      'system-prompt-write',
      'command-execution',
    ],
  },
  paths: {
    allowedRoots: ['D:\\craft-agents-oss'],
    artifactRoot: '',
    backupRoot: '',
  },
  privacy: {
    telemetry: false,
    cloudMemory: false,
    redactSecretsInLogs: true,
  },
};

export function validateOwnerProfile(data: unknown): OwnerProfile {
  return OwnerProfileSchema.parse(data) as OwnerProfile;
}
