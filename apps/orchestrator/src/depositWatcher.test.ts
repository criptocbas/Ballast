import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  classifyAuthority,
  extractAmountUsdc,
  findInboundTransferToVault,
} from './depositWatcher.js';

const VAULT_ATA = 'F4WoiE9KHGY3qfNhwEdH2QmQX2k4tpSoGqvDfoMx2zsX'; // arbitrary on-chain-shaped string
const TOKEN_CLASSIC = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function makeTransferIx(
  programId: string,
  destination: string,
  amount: string,
  authority: string,
  mint?: string,
) {
  return {
    programId: new PublicKey(programId),
    parsed: {
      type: 'transferChecked' as const,
      info: {
        destination,
        source: 'someSourceAta11111111111111111111111111111111',
        authority,
        amount,
        ...(mint ? { mint } : {}),
        tokenAmount: { amount, decimals: 6 },
      },
    },
  };
}

describe('classifyAuthority', () => {
  it('returns "self" when the authority is the vault wallet', () => {
    const kp = Keypair.generate();
    const vault = kp.publicKey.toBase58();
    expect(classifyAuthority(vault, vault)).toBe('self');
  });

  it('returns "user" for a regular wallet pubkey (on-curve)', () => {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const vault = Keypair.generate().publicKey.toBase58();
    expect(classifyAuthority(wallet, vault)).toBe('user');
  });

  it('returns "pda" for a program-derived address (off-curve)', () => {
    // findProgramAddressSync produces an off-curve PDA by definition.
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('test')],
      new PublicKey(TOKEN_CLASSIC),
    );
    const vault = Keypair.generate().publicKey.toBase58();
    expect(classifyAuthority(pda.toBase58(), vault)).toBe('pda');
  });

  it('returns "invalid" for missing authority', () => {
    const vault = Keypair.generate().publicKey.toBase58();
    expect(classifyAuthority(undefined, vault)).toBe('invalid');
  });

  it('returns "invalid" for a malformed pubkey', () => {
    const vault = Keypair.generate().publicKey.toBase58();
    expect(classifyAuthority('not-a-real-pubkey', vault)).toBe('invalid');
  });
});

describe('findInboundTransferToVault', () => {
  it('finds a top-level transferChecked targeting the vault ATA', () => {
    const kp = Keypair.generate();
    const ix = makeTransferIx(TOKEN_CLASSIC, VAULT_ATA, '2000000', kp.publicKey.toBase58());
    const result = findInboundTransferToVault([ix], [], VAULT_ATA);
    expect(result).not.toBeNull();
    expect(result?.parsed.info.destination).toBe(VAULT_ATA);
  });

  it('finds an inner transferChecked targeting the vault ATA', () => {
    const kp = Keypair.generate();
    const ix = makeTransferIx(TOKEN_CLASSIC, VAULT_ATA, '5000000', kp.publicKey.toBase58());
    const result = findInboundTransferToVault([], [[ix]], VAULT_ATA);
    expect(result).not.toBeNull();
  });

  it('returns null when no instruction targets the vault ATA', () => {
    const kp = Keypair.generate();
    const otherDest = 'someOtherAta11111111111111111111111111111111';
    const ix = makeTransferIx(TOKEN_CLASSIC, otherDest, '1000000', kp.publicKey.toBase58());
    const result = findInboundTransferToVault([ix], [], VAULT_ATA);
    expect(result).toBeNull();
  });

  it('matches Token-2022 program transfers as well', () => {
    const kp = Keypair.generate();
    const ix = makeTransferIx(TOKEN_2022, VAULT_ATA, '1000000', kp.publicKey.toBase58());
    const result = findInboundTransferToVault([ix], [], VAULT_ATA);
    expect(result).not.toBeNull();
  });

  it('ignores instructions from non-token programs', () => {
    const kp = Keypair.generate();
    const fakeIx = {
      programId: new PublicKey('11111111111111111111111111111111'),
      parsed: {
        type: 'transferChecked' as const,
        info: { destination: VAULT_ATA, authority: kp.publicKey.toBase58() },
      },
    };
    const result = findInboundTransferToVault([fakeIx], [], VAULT_ATA);
    expect(result).toBeNull();
  });
});

describe('extractAmountUsdc', () => {
  it('reads tokenAmount.amount when present', () => {
    const ix = makeTransferIx(
      TOKEN_CLASSIC,
      VAULT_ATA,
      '5000000',
      Keypair.generate().publicKey.toBase58(),
    );
    expect(extractAmountUsdc(ix)).toBeCloseTo(5, 9);
  });

  it('returns null on malformed amount', () => {
    const broken = makeTransferIx(
      TOKEN_CLASSIC,
      VAULT_ATA,
      'not-a-number',
      Keypair.generate().publicKey.toBase58(),
    );
    expect(extractAmountUsdc(broken)).toBeNull();
  });
});
