import { KVNamespace } from '@cloudflare/workers-types';

// Dual-track login throttling per REWRITE_PLAN.md §5.2.
//
// The previous single key was `login_fail:{ip}:{id}`, which only ever counted the
// (ip, account) pair. An attacker rotating source IPs got a fresh 5 attempts per IP
// against the same account, and an attacker spraying many accounts from one IP was
// never counted at all. Two independent counters close both directions:
//
//   account track — 5 failures per account per 15 min, regardless of origin
//   ip track      — 30 failures per IP per 15 min, across all accounts
//
// The IP allowance is deliberately looser than the account one because an agency
// office reaches the service through a small number of shared egress addresses.

export const LOCKOUT_WINDOW_SECONDS = 900; // 15 minutes
export const MAX_ACCOUNT_FAILURES = 5;
export const MAX_IP_FAILURES = 30;

const accountKey = (id: string) => `login_fail:account:${id}`;
const ipKey = (ip: string) => `login_fail:ip:${ip}`;

async function readCount(kv: KVNamespace, key: string): Promise<number> {
  const raw = await kv.get(key);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface LockoutState {
  locked: boolean;
  /** Which track tripped, for audit purposes. Never disclosed to the caller. */
  reason?: 'account' | 'ip';
}

export async function checkLockout(
  kv: KVNamespace,
  userId: string,
  ip: string
): Promise<LockoutState> {
  const [accountFailures, ipFailures] = await Promise.all([
    readCount(kv, accountKey(userId)),
    readCount(kv, ipKey(ip)),
  ]);

  if (accountFailures >= MAX_ACCOUNT_FAILURES) return { locked: true, reason: 'account' };
  if (ipFailures >= MAX_IP_FAILURES) return { locked: true, reason: 'ip' };
  return { locked: false };
}

export async function recordFailure(kv: KVNamespace, userId: string, ip: string): Promise<void> {
  const [accountFailures, ipFailures] = await Promise.all([
    readCount(kv, accountKey(userId)),
    readCount(kv, ipKey(ip)),
  ]);

  // Note: KV has no atomic increment, so concurrent failures can under-count. That is
  // acceptable here — the counter is a throttle, not an accounting record, and the
  // audit log carries the authoritative history of failed attempts.
  await Promise.all([
    kv.put(accountKey(userId), String(accountFailures + 1), {
      expirationTtl: LOCKOUT_WINDOW_SECONDS,
    }),
    kv.put(ipKey(ip), String(ipFailures + 1), { expirationTtl: LOCKOUT_WINDOW_SECONDS }),
  ]);
}

export async function clearAccountFailures(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(accountKey(userId));
}
