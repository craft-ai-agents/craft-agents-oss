import { createRequire } from 'node:module'
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Database } from 'bun:sqlite'

/**
 * Account service runs in Bun, not the Electron host. Load the native driver
 * lazily so importing the webui barrel from Electron does not require Bun.
 * One transaction protects the legacy account document and its ledger together.
 * The original JSON remains untouched as a pre-migration backup.
 */
export class AccountDatabaseFile<T> {
  readonly databasePath: string
  constructor(private readonly legacyPath: string, private readonly validate: (value: unknown) => T) {
    this.databasePath = `${legacyPath}.sqlite`
  }

  private open(): Database {
    mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 })
    const { Database: Driver } = createRequire(join(process.cwd(), 'package.json'))('bun:sqlite') as typeof import('bun:sqlite')
    const db = new Driver(this.databasePath, { create: true, strict: true })
    try {
      chmodSync(this.databasePath, 0o600)
      db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;')
      db.exec('CREATE TABLE IF NOT EXISTS account_state (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
      return db
    } catch (error) { db.close(); throw error }
  }

  private readState(db: Database): T {
    const row = db.query<{ body: string }, []>('SELECT body FROM account_state WHERE id = 1').get()
    if (row) return this.validate(JSON.parse(row.body))
    return this.validate(existsSync(this.legacyPath)
      ? JSON.parse(readFileSync(this.legacyPath, 'utf8')) : { version: 1, accounts: [] })
  }

  read(): T {
    const db = this.open()
    try { return this.readState(db) } finally { db.close() }
  }

  transaction<R>(operation: (state: T) => R): R {
    const db = this.open()
    try {
      return db.transaction(() => {
        const state = this.readState(db)
        const result = operation(state)
        if (result instanceof Promise) throw new Error('Account transactions must be synchronous')
        db.query('INSERT INTO account_state (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body')
          .run(JSON.stringify(state))
        return result
      }).immediate()
    } finally { db.close() }
  }
}
