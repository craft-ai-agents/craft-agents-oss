export interface OwnerProfileIdentity {
  name: string;
  aliases: string[];
  locale: string;
  timezone: string;
}

export interface OwnerProfileCommunication {
  tone: string;
  verbosity: number;
  bannedPhrases: string[];
}

export interface OwnerProfileExecution {
  defaultMode: 'explore' | 'owner-auto' | 'unrestricted';
  askOnlyWhen: string[];
}

export interface OwnerProfilePaths {
  allowedRoots: string[];
  artifactRoot: string;
  backupRoot: string;
}

export interface OwnerProfilePrivacy {
  telemetry: boolean;
  cloudMemory: boolean;
  redactSecretsInLogs: boolean;
}

export interface OwnerProfile {
  identity: OwnerProfileIdentity;
  communication: OwnerProfileCommunication;
  execution: OwnerProfileExecution;
  paths: OwnerProfilePaths;
  privacy: OwnerProfilePrivacy;
  updatedAt?: number;
}
