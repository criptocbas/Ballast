import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ballast-nonces-'));
  process.env.DATABASE_URL = `file:${join(tmp, 'reflux.sqlite')}`;
});

beforeEach(async () => {
  const { getDb } = await import('./db/index.js');
  const { nonces } = await import('./db/schema.js');
  getDb().delete(nonces).run();
});

function signMessage(kp: Keypair, message: string): string {
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return bs58.encode(sig);
}

describe('buildCanonicalMessage', () => {
  it('produces a stable, sorted-bindings format', async () => {
    const { buildCanonicalMessage } = await import('./nonces.js');
    const message = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce: 'abc',
      bindings: { signature: 'sig123', amount: '5.000000' },
    });
    expect(message).toBe('ballast:deposit-confirm\nnonce=abc\namount=5.000000&signature=sig123');
  });

  it('different bindings produce different messages', async () => {
    const { buildCanonicalMessage } = await import('./nonces.js');
    const a = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce: 'n1',
      bindings: { amount: '5' },
    });
    const b = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce: 'n1',
      bindings: { amount: '10' },
    });
    expect(a).not.toBe(b);
  });
});

describe('verifySignedMessageAndConsume', () => {
  it('accepts a valid signed proof and consumes the nonce', async () => {
    const { issueNonce, buildCanonicalMessage, verifySignedMessageAndConsume } = await import(
      './nonces.js'
    );
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const { nonce } = issueNonce({ wallet, purpose: 'deposit-confirm' });
    const message = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce,
      bindings: { amount: '5.000000', signature: 'sig123' },
    });
    const signature = signMessage(kp, message);

    expect(() =>
      verifySignedMessageAndConsume({
        wallet,
        purpose: 'deposit-confirm',
        nonce,
        message,
        signature,
      }),
    ).not.toThrow();
  });

  it('rejects a replayed nonce', async () => {
    const { issueNonce, buildCanonicalMessage, verifySignedMessageAndConsume, NonceVerifyError } =
      await import('./nonces.js');
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const { nonce } = issueNonce({ wallet, purpose: 'deposit-confirm' });
    const message = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce,
      bindings: { amount: '5' },
    });
    const signature = signMessage(kp, message);

    verifySignedMessageAndConsume({
      wallet,
      purpose: 'deposit-confirm',
      nonce,
      message,
      signature,
    });

    expect(() =>
      verifySignedMessageAndConsume({
        wallet,
        purpose: 'deposit-confirm',
        nonce,
        message,
        signature,
      }),
    ).toThrow(NonceVerifyError);
  });

  it('rejects a signature from the wrong wallet', async () => {
    const { issueNonce, buildCanonicalMessage, verifySignedMessageAndConsume, NonceVerifyError } =
      await import('./nonces.js');
    const kpAlice = Keypair.generate();
    const kpMallory = Keypair.generate();
    const wallet = kpAlice.publicKey.toBase58();
    const { nonce } = issueNonce({ wallet, purpose: 'deposit-confirm' });
    const message = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce,
      bindings: { amount: '5' },
    });
    // Mallory signs the message with her key; the server thinks it's Alice's nonce.
    const malloryRsignature = signMessage(kpMallory, message);

    expect(() =>
      verifySignedMessageAndConsume({
        wallet,
        purpose: 'deposit-confirm',
        nonce,
        message,
        signature: malloryRsignature,
      }),
    ).toThrow(NonceVerifyError);
  });

  it('rejects when the nonce was issued for a different wallet', async () => {
    const { issueNonce, buildCanonicalMessage, verifySignedMessageAndConsume, NonceVerifyError } =
      await import('./nonces.js');
    const kpAlice = Keypair.generate();
    const kpBob = Keypair.generate();
    const { nonce } = issueNonce({ wallet: kpAlice.publicKey.toBase58(), purpose: 'deposit-confirm' });
    const message = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce,
      bindings: { amount: '5' },
    });
    const signature = signMessage(kpBob, message);

    expect(() =>
      verifySignedMessageAndConsume({
        wallet: kpBob.publicKey.toBase58(),
        purpose: 'deposit-confirm',
        nonce,
        message,
        signature,
      }),
    ).toThrow(NonceVerifyError);
  });

  it('rejects when the purpose mismatches', async () => {
    const { issueNonce, buildCanonicalMessage, verifySignedMessageAndConsume, NonceVerifyError } =
      await import('./nonces.js');
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const { nonce } = issueNonce({ wallet, purpose: 'deposit-confirm' });
    const message = buildCanonicalMessage({
      purpose: 'withdraw-request',
      nonce,
      bindings: { amount: '5' },
    });
    const signature = signMessage(kp, message);

    expect(() =>
      verifySignedMessageAndConsume({
        wallet,
        purpose: 'withdraw-request',
        nonce,
        message,
        signature,
      }),
    ).toThrow(NonceVerifyError);
  });

  it('rejects an unknown nonce', async () => {
    const { buildCanonicalMessage, verifySignedMessageAndConsume, NonceVerifyError } = await import(
      './nonces.js'
    );
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const message = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce: 'never-issued',
      bindings: { amount: '5' },
    });
    const signature = signMessage(kp, message);

    expect(() =>
      verifySignedMessageAndConsume({
        wallet,
        purpose: 'deposit-confirm',
        nonce: 'never-issued',
        message,
        signature,
      }),
    ).toThrow(NonceVerifyError);
  });

  it('rejects a tampered amount (binding mismatch)', async () => {
    const { issueNonce, buildCanonicalMessage, verifySignedMessageAndConsume, NonceVerifyError } =
      await import('./nonces.js');
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const { nonce } = issueNonce({ wallet, purpose: 'deposit-confirm' });
    // Alice signs $5 message
    const aliceMsg = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce,
      bindings: { amount: '5' },
    });
    const signature = signMessage(kp, aliceMsg);
    // Server-side verifier expects $5000 — different bindings, signature won't verify
    const tamperedMsg = buildCanonicalMessage({
      purpose: 'deposit-confirm',
      nonce,
      bindings: { amount: '5000' },
    });

    expect(() =>
      verifySignedMessageAndConsume({
        wallet,
        purpose: 'deposit-confirm',
        nonce,
        message: tamperedMsg,
        signature,
      }),
    ).toThrow(NonceVerifyError);
  });
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});
