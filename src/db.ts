import { DatabaseSync, backup } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class Store {
  db: DatabaseSync;
  path: string;
  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    if (path !== ':memory:' && process.platform !== 'win32') chmodSync(path, 0o600);
  }
  get<T>(sql: string, ...args: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  all<T>(sql: string, ...args: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }
  run(sql: string, ...args: SQLInputValue[]) { return this.db.prepare(sql).run(...args); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      if (result instanceof Promise) throw new Error('Transactions must be synchronous');
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  migrate(through = Number.MAX_SAFE_INTEGER) {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
    const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
    const files = readdirSync(directory).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    const known = new Set(files.map(name => Number(name.split('_')[0])));
    for (const row of this.all<{version:number}>('SELECT version FROM schema_migrations')) {
      if (!known.has(row.version)) throw new Error('Database schema is newer than this application');
    }
    for (const name of files) {
      const version = Number(name.split('_')[0]);
      const sql = readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      this.transaction(() => {
        const applied = this.get<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE version=?', version);
        if (applied && applied.checksum !== checksum) throw new Error('Applied migration checksum mismatch');
        if (applied || version > through) return;
        this.db.exec(sql);
        this.run('INSERT INTO schema_migrations VALUES (?,?,?,?)', version, name, checksum, new Date().toISOString());
      });
    }
  }
  close() { this.db.close(); }
  async backupTo(destination: string) {
    if (existsSync(destination) || resolve(destination) === resolve(this.path)) throw new Error('Backup destination must be new');
    mkdirSync(dirname(resolve(destination)), { recursive: true, mode: 0o700 });
    await backup(this.db, destination);
    if (process.platform !== 'win32') chmodSync(destination, 0o600);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      if (copy.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
          copy.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup validation failed');
    } finally { copy.close(); }
  }
}
