import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expandPath, toPortablePath } from '../paths'

test('home path remains portable through repeated serialization and expands to the original root', () => {
  const root=join(homedir(),'AppData','Local','Temp','synthetic-no-files')
  const portable=toPortablePath(root)
  expect(portable).toBe('~/AppData/Local/Temp/synthetic-no-files')
  expect(toPortablePath(portable)).toBe(portable)
  expect(expandPath(toPortablePath(portable))).toBe(root)
  expect(expandPath('~\\AppData\\Local\\Temp\\synthetic-no-files')).toBe(root)
})
