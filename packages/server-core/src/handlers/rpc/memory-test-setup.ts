/**
 * Test-side env setup: CRAFT_CONFIG_DIR is read by
 * @craft-agent/shared/config/paths at module-eval time, so it must be set
 * before any module under test loads. Import this file FIRST in handler tests.
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.CRAFT_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'mem-hdl-config-'))
