import type { ApiObservation } from '@reflux/shared';
import { desc } from 'drizzle-orm';
import { observations } from './db/schema.js';
import { getDb } from './db/index.js';

/**
 * In-memory ring buffer of API observations + persistence to SQLite.
 *
 * The /dx public page reads from the in-memory buffer for sub-millisecond reads;
 * the SQLite mirror means the log survives restarts and is queryable at scale.
 */

const MAX_BUFFER = 1_000;

const buffer: ApiObservation[] = [];
let dbReady = false;

function ensureDb(): void {
  if (dbReady) return;
  // First call: trigger getDb (runs migrations) and seed the in-memory buffer
  // from the most recent persisted observations so /dx isn't empty after a restart.
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(observations)
      .orderBy(desc(observations.startedAt))
      .limit(MAX_BUFFER)
      .all();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!r) continue;
      buffer.push({
        method: r.method,
        path: r.path,
        startedAt: r.startedAt,
        durationMs: r.durationMs,
        status: r.status,
        ok: Boolean(r.ok),
        ...(r.errorMessage ? { errorMessage: r.errorMessage } : {}),
      });
    }
    dbReady = true;
  } catch {
    // If db is unavailable for any reason, fall back to in-memory only.
  }
}

export function recordObservation(obs: ApiObservation): void {
  ensureDb();
  buffer.push(obs);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  if (dbReady) {
    try {
      getDb()
        .insert(observations)
        .values({
          method: obs.method,
          path: obs.path,
          startedAt: obs.startedAt,
          durationMs: obs.durationMs,
          status: obs.status,
          ok: obs.ok,
          errorMessage: obs.errorMessage ?? null,
        })
        .run();
    } catch {
      // Persistence failures don't fail the upstream request.
    }
  }
}

export function readRecentObservations(limit = 100): ApiObservation[] {
  ensureDb();
  return buffer.slice(-limit).reverse();
}
