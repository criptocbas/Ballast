import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../config.js';

/**
 * SQLite + Drizzle wiring.
 *
 *  - Path resolved from DATABASE_URL (`file:./reflux.sqlite` by default).
 *  - WAL mode for safe-ish concurrent reads while the rebalance loop writes.
 *  - Migrations live in `apps/orchestrator/drizzle/` and auto-run on first
 *    `getDb()` call. Idempotent — safe to call from any module that needs db.
 */

let cached: ReturnType<typeof drizzle> | undefined;

function resolveDbPath(): string {
  const cfg = loadConfig();
  const raw = cfg.DATABASE_URL.startsWith('file:')
    ? cfg.DATABASE_URL.slice('file:'.length)
    : cfg.DATABASE_URL;
  // Resolve relative paths against the workspace root so cwd doesn't matter.
  if (path.isAbsolute(raw)) return raw;
  // The orchestrator's default cwd is the package or the workspace root depending on caller;
  // we anchor to the package root for stability.
  const here = dirname(fileURLToPath(import.meta.url));
  // src/db -> .. -> .. (= apps/orchestrator)
  const pkgRoot = path.resolve(here, '..', '..');
  return path.resolve(pkgRoot, raw);
}

function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'drizzle');
}

export function getDb(): ReturnType<typeof drizzle> {
  if (cached) return cached;
  const dbPath = resolveDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  cached = drizzle(sqlite);
  // Run migrations the first time the db is opened.
  if (existsSync(migrationsFolder())) {
    migrate(cached, { migrationsFolder: migrationsFolder() });
  }
  return cached;
}
