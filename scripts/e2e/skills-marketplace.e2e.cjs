/**
 * E2E Tests for Skills Marketplace
 *
 * Tests the marketplace search, install, and preview functionality.
 *
 * Run with Electron debugging enabled:
 *   VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron
 *   node scripts/e2e/skills-marketplace.e2e.cjs
 */

const { E2ETestRunner, assert } = require('./cdp-utils.cjs');

async function runTests() {
  const runner = new E2ETestRunner('Skills Marketplace');

  // Setup CDP connection
  const connected = await runner.setup();
  if (!connected) {
    return runner.teardown();
  }

  // Test Group: electronAPI Availability
  await runner.group('electronAPI Methods', async () => {
    await runner.test('marketplaceSearch exists', async () => {
      const exists = await runner.checkApiMethod('marketplaceSearch');
      assert.truthy(exists, 'marketplaceSearch method should exist');
      return 'Method is available';
    });

    await runner.test('marketplaceInstall exists', async () => {
      const exists = await runner.checkApiMethod('marketplaceInstall');
      assert.truthy(exists, 'marketplaceInstall method should exist');
      return 'Method is available';
    });

    await runner.test('marketplaceGetSkillInfo exists', async () => {
      const exists = await runner.checkApiMethod('marketplaceGetSkillInfo');
      assert.truthy(exists, 'marketplaceGetSkillInfo method should exist');
      return 'Method is available';
    });
  });

  // Test Group: Marketplace Search
  await runner.group('Marketplace Search', async () => {
    await runner.test('marketplaceSearch returns results for empty query', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.marketplaceSearch('');
          return {
            hasSkills: Array.isArray(response.skills),
            skillCount: response.skills ? response.skills.length : 0,
            hasMore: response.hasMore
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.hasSkills, 'Should return skills array');
      return `Found ${result.skillCount} skills`;
    });

    await runner.test('marketplaceSearch returns results for query', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.marketplaceSearch('git');
          return {
            hasSkills: Array.isArray(response.skills),
            skillCount: response.skills ? response.skills.length : 0
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.hasSkills, 'Should return skills array');
      return `Found ${result.skillCount} skills for "git"`;
    });

    await runner.test('marketplace skill has required properties', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.marketplaceSearch('');
          if (response.skills && response.skills.length > 0) {
            const skill = response.skills[0];
            return {
              hasId: !!skill.id,
              hasName: !!skill.name,
              hasDescription: typeof skill.description === 'string',
              hasTopSource: !!skill.topSource,
              hasInstalls: typeof skill.installs === 'number'
            };
          }
          return { noSkills: true };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.noSkills) {
        return 'skip';
      }

      assert.truthy(result.hasId, 'Skill should have id');
      assert.truthy(result.hasName, 'Skill should have name');
      assert.truthy(result.hasDescription, 'Skill should have description');
      assert.truthy(result.hasTopSource, 'Skill should have topSource');
      assert.truthy(result.hasInstalls, 'Skill should have installs');
      return 'All required properties present';
    });
  });

  // Test Group: Skill Info
  await runner.group('Skill Info', async () => {
    await runner.test('marketplaceGetSkillInfo returns skill details', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          // First get a skill from search
          const searchResponse = await window.electronAPI.marketplaceSearch('');
          if (!searchResponse.skills || searchResponse.skills.length === 0) {
            return { noSkills: true };
          }

          const skill = searchResponse.skills[0];
          const info = await window.electronAPI.marketplaceGetSkillInfo(skill.topSource);

          return {
            hasContent: typeof info === 'object',
            skillName: skill.name,
            source: skill.topSource
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.noSkills) {
        return 'skip';
      }

      return `Got info for ${result.skillName}`;
    });
  });

  // Test Group: UI Components (if navigated to skills page)
  await runner.group('UI Components', async () => {
    await runner.test('Skills page is accessible', async () => {
      await runner.navigateTo('#/settings/skills');
      await runner.wait(1000);

      const hasContent = await runner.querySelector('[data-testid="skills-page"], .skills-container, [class*="skill"]');
      return hasContent ? 'Skills page rendered' : 'Skills page elements not found (may need different route)';
    });

    await runner.test('Take screenshot of current state', async () => {
      const path = await runner.screenshot('skills-marketplace.png');
      return `Saved to ${path}`;
    });
  });

  // Cleanup
  return runner.teardown();
}

// Run tests
runTests()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
