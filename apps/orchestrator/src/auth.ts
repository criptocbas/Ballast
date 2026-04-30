import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadConfig } from './config.js';

/**
 * Admin auth — Bearer token check for endpoints that mutate vault state on
 * behalf of the operator (rebalance trigger, claim sweep, depositor list).
 *
 * Lookup order: `Authorization: Bearer <token>`, falling back to the
 * `x-admin-token` header for tools that can't set Authorization (e.g. some
 * curl wrappers). Tokens compared in constant time.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.ORCHESTRATOR_ADMIN_TOKEN) {
    return reply.code(503).send({
      error: 'admin_disabled',
      message: 'ORCHESTRATOR_ADMIN_TOKEN not set; admin endpoints disabled',
    });
  }
  const provided = extractToken(req);
  if (!provided || !timingSafeEqual(provided, cfg.ORCHESTRATOR_ADMIN_TOKEN)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

function extractToken(req: FastifyRequest): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string') {
    const match = /^Bearer\s+(.+)$/.exec(authHeader);
    if (match?.[1]) return match[1].trim();
  }
  const xAdmin = req.headers['x-admin-token'];
  if (typeof xAdmin === 'string') return xAdmin.trim();
  return undefined;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
