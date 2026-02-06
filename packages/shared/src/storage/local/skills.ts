/**
 * Local Skill Storage
 *
 * Delegates to existing skill storage functions from skills/storage.ts
 */

import type { ISkillStorage } from '../types.ts';
import type { LoadedSkill } from '../../skills/types.ts';

import {
  loadSkill as fsLoadSkill,
  loadWorkspaceSkills as fsLoadWorkspaceSkills,
  deleteSkill as fsDeleteSkill,
  listSkillSlugs as fsListSkillSlugs,
} from '../../skills/storage.ts';

export class LocalSkillStorage implements ISkillStorage {
  constructor(private rootPath: string) {}

  async loadSkill(slug: string): Promise<LoadedSkill | null> {
    return fsLoadSkill(this.rootPath, slug);
  }

  async loadWorkspaceSkills(): Promise<LoadedSkill[]> {
    return fsLoadWorkspaceSkills(this.rootPath);
  }

  async deleteSkill(slug: string): Promise<boolean> {
    return fsDeleteSkill(this.rootPath, slug);
  }

  async listSkillSlugs(): Promise<string[]> {
    return fsListSkillSlugs(this.rootPath);
  }
}
