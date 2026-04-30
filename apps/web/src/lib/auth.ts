/**
 * Sign-message helpers — the client side of the orchestrator's nonce-based auth.
 *
 * Mirrors `apps/orchestrator/src/nonces.ts:buildCanonicalMessage` exactly.
 * If you change one, change the other — the canonical message format is the
 * thing the wallet signature commits to.
 */

export type NoncePurpose = 'deposit-confirm' | 'withdraw-request';

export interface RequestNonceArgs {
  wallet: string;
  purpose: NoncePurpose;
}

export interface RequestNonceResponse {
  nonce: string;
  expiresAt: number;
}

export async function requestNonce(
  orchestratorUrl: string,
  args: RequestNonceArgs,
): Promise<RequestNonceResponse> {
  const res = await fetch(`${orchestratorUrl}/api/auth/nonce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to request nonce: ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as RequestNonceResponse;
}

export interface BuildMessageArgs {
  purpose: NoncePurpose;
  nonce: string;
  bindings: Record<string, string | number>;
}

export function buildCanonicalMessage(args: BuildMessageArgs): string {
  const sortedBindings = Object.entries(args.bindings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return `ballast:${args.purpose}\nnonce=${args.nonce}\n${sortedBindings}`;
}
