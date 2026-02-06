/**
 * Cloud Skill Storage
 *
 * Implements ISkillStorage via WebSocket mutations and REST reads.
 */

import type { ISkillStorage } from '../types.ts';
import type { LoadedSkill, SkillMetadata } from '../../skills/types.ts';
import type { CloudConnection } from './connection.ts';

interface CloudSkillRecord {
  slug: string;
  content: string;
  metadata: SkillMetadata | null;
}

export class CloudSkillStorage implements ISkillStorage {
  constructor(private connection: CloudConnection) {}

  async loadSkill(slug: string): Promise<LoadedSkill | null> {
    const skills = await this.connection.fetch<CloudSkillRecord[]>('/skills');
    const skill = skills.find(s => s.slug === slug);
    if (!skill || !skill.metadata) return null;

    return {
      slug: skill.slug,
      metadata: skill.metadata,
      content: skill.content,
      path: '',
      source: 'workspace',
    };
  }

  async loadWorkspaceSkills(): Promise<LoadedSkill[]> {
    const skills = await this.connection.fetch<CloudSkillRecord[]>('/skills');
    return skills
      .filter(s => s.metadata)
      .map(s => ({
        slug: s.slug,
        metadata: s.metadata!,
        content: s.content,
        path: '',
        source: 'workspace' as const,
      }));
  }

  async deleteSkill(slug: string): Promise<boolean> {
    await this.connection.send({
      type: 'skill:delete',
      data: { slug },
    });
    return true;
  }

  async listSkillSlugs(): Promise<string[]> {
    const skills = await this.connection.fetch<CloudSkillRecord[]>('/skills');
    return skills.map(s => s.slug);
  }
}
