import type { ApiObservation } from '@reflux/shared';

/**
 * In-memory ring buffer of API observations. The frontend's `/dx` page reads
 * these and surfaces friction points to judges. We persist to SQLite below.
 *
 * NOTE: in-memory only for v1; SQLite persistence comes when the schema lands.
 */

const MAX_BUFFER = 1_000;

const buffer: ApiObservation[] = [];

export function recordObservation(obs: ApiObservation): void {
  buffer.push(obs);
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

export function readRecentObservations(limit = 100): ApiObservation[] {
  return buffer.slice(-limit).reverse();
}
