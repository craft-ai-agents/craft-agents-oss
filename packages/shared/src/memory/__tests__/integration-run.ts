const { mkdirSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const memorySrc = join(__dirname, '..');
const { openMemoryDatabase, bootstrapStorage, createAuditEntry } = require('../database');

const tmpDir = tmpdir();
const dir = join(tmpDir, 'craft-memory-integration-' + Date.now());
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const dbPath = join(dir, 'memory.db');
const db = openMemoryDatabase(dbPath);
bootstrapStorage(db);

const nowIso = new Date().toISOString();

console.log('Insert test rows...');
const insert = db.prepare(
  'INSERT INTO memories (id, class, scope, title, content, confidence, sensitivity, tags, archived, created_at, updated_at, archive_on_supersede, supersedes_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
insert.run('mem:1', 'profile', 'global', 'User name', 'John Doe', 0.9, 'internal', '[]', '0', nowIso, nowIso, '1', '[]');
insert.run('mem:2', 'semantic', 'project', 'MyProject stack', 'Bun + React', 0.8, 'internal', '[]', '0', nowIso, nowIso, '1', '[]');

console.log('Query active global profile...');
const globalRows = db.prepare('SELECT * FROM memories WHERE scope = ? AND archived = 0').all('global');
console.log(JSON.stringify(globalRows, null, 2));

console.log('Query active project semantic...');
const projectRows = db.prepare('SELECT * FROM memories WHERE scope = ? AND archived = 0').all('project');
console.log(JSON.stringify(projectRows, null, 2));

console.log('Waste mem1 in-place...');
db.run('UPDATE memories SET archived = 1, updated_at = ? WHERE id = ?', [nowIso, 'mem:1']);

console.log('Query global after waste (should be empty)...');
const after = db.prepare('SELECT * FROM memories WHERE scope = ? AND archived = 0').all('global');
console.log(JSON.stringify(after, null, 2));

console.log('Create audit for mem2...');
createAuditEntry(db, {
  id: 'audit:mem2:create',
  memoryId: 'mem:2',
  action: 'create',
  previousContent: null,
  newContent: 'Bun + React',
  timestamp: nowIso,
  actor: 'integration-test',
});

console.log('Read audit rows...');
const audits = db.prepare('SELECT * FROM memory_audit WHERE memory_id = ?').all('mem:2');
console.log(JSON.stringify(audits, null, 2));

db.close();
console.log('Integration run complete:', dbPath);
