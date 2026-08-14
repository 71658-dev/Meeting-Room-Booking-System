import { describe, it, expect } from 'vitest';
import {
  hashPasswordChain,
  verifyPasswordChain,
  sha256Hex,
  timingSafeEqual,
} from '../src/server/auth/crypto';
import { validatePasswordPolicy, MIN_PASSWORD_LENGTH } from '../src/server/auth/passwordPolicy';
import { escapeHtml, isAllowedRecipient, parseRecipients } from '../src/server/services/email';
import { redactSensitive } from '../src/server/middleware/audit';
import { computeHourRange } from '../src/client/lib/timeline';
import {
  agencyToday,
  agencyMinutesNow,
  isPastDate,
  isPastSlot,
  timeStrToMin,
  minToTimeStr,
} from '../src/shared/time';

describe('password hashing', () => {
  it('round-trips a chained pbkdf2c hash', async () => {
    const hash = await hashPasswordChain('correct horse battery staple');
    expect(hash).toMatch(/^pbkdf2c\$sha256\$6x100000\$/);

    const ok = await verifyPasswordChain('correct horse battery staple', hash);
    expect(ok).toEqual({ ok: true, needsUpgrade: false });
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPasswordChain('correct horse battery staple');
    const result = await verifyPasswordChain('Correct horse battery staple', hash);
    expect(result.ok).toBe(false);
  });

  it('uses a fresh salt per call', async () => {
    const [a, b] = await Promise.all([hashPasswordChain('same'), hashPasswordChain('same')]);
    expect(a).not.toBe(b);
  });

  // The compatibility chain is the reason existing accounts can still log in. Every one
  // of these formats is present in the live data; dropping a branch locks people out.
  describe('backward-compatible verification chain', () => {
    it('accepts an unsalted SHA-256 hex hash and flags it for upgrade', async () => {
      const legacy = await sha256Hex('legacy-password');
      const result = await verifyPasswordChain('legacy-password', legacy);
      expect(result).toEqual({ ok: true, needsUpgrade: true });
    });

    it('accepts a v1 static-salt hash and flags it for upgrade', async () => {
      const stored = `v1$${await sha256Hex('hccg_health_booking_v1_salt_2026' + 'pw')}`;
      const result = await verifyPasswordChain('pw', stored);
      expect(result).toEqual({ ok: true, needsUpgrade: true });
    });

    it('accepts a v2 dynamic-salt hash and flags it for upgrade', async () => {
      const salt = 'abc123';
      const stored = `v2$${salt}$${await sha256Hex(salt + 'pw')}`;
      const result = await verifyPasswordChain('pw', stored);
      expect(result).toEqual({ ok: true, needsUpgrade: true });
    });

    it('accepts a single-round pbkdf2 hash without throwing', async () => {
      // Regression: this branch spread an ArrayBuffer into String.fromCharCode, which
      // throws at runtime, so every account still on the 1x100k format hit a 500.
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode('pw'), 'PBKDF2', false, ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
      );
      const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
      const stored = `pbkdf2$sha256$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;

      const result = await verifyPasswordChain('pw', stored);
      expect(result).toEqual({ ok: true, needsUpgrade: true });
    });

    it('rejects an empty or malformed stored hash', async () => {
      expect(await verifyPasswordChain('pw', '')).toEqual({ ok: false, needsUpgrade: false });
      expect(await verifyPasswordChain('pw', 'not-a-hash')).toEqual({ ok: false, needsUpgrade: false });
    });
  });

  it('compares in constant time without short-circuiting on content', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('password policy', () => {
  const ctx = { userId: '71658', name: '王小明' };

  it(`rejects passwords shorter than ${MIN_PASSWORD_LENGTH}`, () => {
    expect(validatePasswordPolicy('Short1!', ctx).ok).toBe(false);
  });

  it('rejects a known weak password', () => {
    expect(validatePasswordPolicy('password1234', ctx).ok).toBe(false);
  });

  it('rejects passwords containing the 工號', () => {
    const result = validatePasswordPolicy('prefix71658suffix', ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('工號');
  });

  it('rejects passwords containing the 姓名', () => {
    expect(validatePasswordPolicy('王小明的祕密密碼abc', ctx).ok).toBe(false);
  });

  it('rejects long runs and sequences', () => {
    expect(validatePasswordPolicy('aaaabbbbccccdddd', ctx).ok).toBe(false);
    expect(validatePasswordPolicy('qq123456xyzzy!!', ctx).ok).toBe(false);
  });

  it('rejects agency-derived terms', () => {
    expect(validatePasswordPolicy('hccg-meeting-2026', ctx).ok).toBe(false);
  });

  it('accepts a reasonable password', () => {
    expect(validatePasswordPolicy('Tangerine-Pylon-47', ctx)).toEqual({ ok: true });
  });

  it('caps absurd lengths so hashing cannot be used to burn CPU', () => {
    expect(validatePasswordPolicy('a1B2'.repeat(100), ctx).ok).toBe(false);
  });
});

describe('timeline hour range', () => {
  it('defaults to office hours when there is nothing booked', () => {
    expect(computeHourRange([])).toEqual({ startHour: 8, endHour: 18 });
  });

  it('keeps the default window for bookings inside it', () => {
    expect(computeHourRange([{ start_min: 9 * 60, end_min: 10 * 60 }])).toEqual({
      startHour: 8,
      endHour: 18,
    });
  });

  it('widens for an early booking that the old fixed grid would have misplaced', () => {
    // 07:30-08:30 used to clamp to left:0, rendering as if it started at 08:00.
    expect(computeHourRange([{ start_min: 450, end_min: 510 }]).startHour).toBe(7);
  });

  it('widens for a late booking that the old fixed grid pushed off the track', () => {
    // 19:00-20:30 used to compute an offset past 100%.
    expect(computeHourRange([{ start_min: 19 * 60, end_min: 20 * 60 + 30 }]).endHour).toBe(21);
  });

  it('covers the full span across several bookings', () => {
    expect(
      computeHourRange([
        { start_min: 7 * 60 + 15, end_min: 8 * 60 },
        { start_min: 13 * 60, end_min: 14 * 60 },
        { start_min: 21 * 60, end_min: 22 * 60 },
      ])
    ).toEqual({ startHour: 7, endHour: 22 });
  });

  it('never exceeds a real day', () => {
    const { startHour, endHour } = computeHourRange([{ start_min: 0, end_min: 24 * 60 }]);
    expect(startHour).toBe(0);
    expect(endHour).toBe(24);
  });
});

/**
 * The backstop under routes/users.ts's allow-list. Routes should pass narrow snapshots,
 * but this is what catches the next one that reaches for `SELECT *` — which is exactly
 * how password_hash ended up in audit_log.before_json in the first place.
 */
describe('audit redaction', () => {
  it('strips credential fields from a whole-row snapshot', () => {
    const row = {
      id: '12345',
      name: '王小明',
      role: 'staff',
      password_hash: 'pbkdf2c$sha256$6x100000$abc$def',
      password_expires_at: '2026-08-14T00:00:00.000Z',
    };

    const redacted = redactSensitive(row) as Record<string, unknown>;

    expect(redacted.password_hash).toBe('[redacted]');
    expect(redacted.password_expires_at).toBe('[redacted]');
    expect(JSON.stringify(redacted)).not.toContain('pbkdf2c');
    // Everything the audit trail is actually for must survive.
    expect(redacted.id).toBe('12345');
    expect(redacted.name).toBe('王小明');
    expect(redacted.role).toBe('staff');
  });

  it('reaches nested values and arrays', () => {
    const redacted = redactSensitive({
      changes: [{ token: 'secret-session-token' }],
      nested: { user: { password: 'hunter2', ext: '100' } },
    }) as any;

    expect(redacted.changes[0].token).toBe('[redacted]');
    expect(redacted.nested.user.password).toBe('[redacted]');
    expect(redacted.nested.user.ext).toBe('100');
  });

  it('passes primitives and null through untouched', () => {
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive('plain')).toBe('plain');
    expect(redactSensitive(42)).toBe(42);
  });
});

describe('email safety', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    );
    expect(escapeHtml(null)).toBe('');
  });

  // A leading dot means "this domain and everything under it"; no dot means exactly
  // this domain. '.gov.tw' is a tree of government hosts so the wildcard is intended;
  // a configured partner domain is not, and must not drag its subdomains in with it.
  const rules = ['.gov.tw', 'example.org'];

  it('allows government domains and their subdomains', () => {
    expect(isAllowedRecipient('someone@ems.hccg.gov.tw', rules)).toBe(true);
    expect(isAllowedRecipient('someone@gov.tw', rules)).toBe(true);
  });

  it('rejects unlisted domains', () => {
    expect(isAllowedRecipient('attacker@evil.com', rules)).toBe(false);
  });

  it('anchors the match at the end so a lookalike domain cannot slip through', () => {
    // Suffix appears but not at the end.
    expect(isAllowedRecipient('attacker@gov.tw.evil.com', rules)).toBe(false);
    // Ends with "gov.tw" but is a different registrable domain: the leading dot in the
    // comparison ('.notgov.tw' vs '.gov.tw') is what rejects it.
    expect(isAllowedRecipient('attacker@notgov.tw', rules)).toBe(false);
  });

  it('does not let a configured domain admit its subdomains', () => {
    // ALLOWED_EMAIL_DOMAINS=example.org used to be stored as '.example.org', so any
    // hostname the partner's DNS could produce was accepted along with it.
    expect(isAllowedRecipient('ok@example.org', rules)).toBe(true);
    expect(isAllowedRecipient('attacker@evil.example.org', rules)).toBe(false);
    // An operator who genuinely wants the subtree opts in with the leading dot.
    expect(isAllowedRecipient('ok@evil.example.org', ['.example.org'])).toBe(true);
  });

  it('partitions a recipient list into accepted and rejected', () => {
    const { accepted, rejected } = parseRecipients(
      'me@ems.hccg.gov.tw',
      'ok@example.org, bad@evil.com; malformed-address',
      rules
    );
    expect(accepted).toEqual(['me@ems.hccg.gov.tw', 'ok@example.org']);
    expect(rejected).toEqual(['bad@evil.com']);
  });
});

describe('agency wall-clock time', () => {
  // Workers run in UTC while the office is on UTC+8, so every one of these cases is a
  // situation where reading the UTC clock gives the wrong answer about "today".
  it('reports the Taipei date, not the UTC date, during the 00:00-08:00 window', () => {
    // 23:30 UTC on the 12th is already 07:30 on the 13th in Taipei.
    const instant = new Date('2026-08-12T23:30:00Z');
    expect(agencyToday(instant)).toBe('2026-08-13');
    expect(instant.toISOString().substring(0, 10)).toBe('2026-08-12');
  });

  it('reports minutes since midnight in Taipei', () => {
    expect(agencyMinutesNow(new Date('2026-08-12T23:30:00Z'))).toBe(7 * 60 + 30);
    expect(agencyMinutesNow(new Date('2026-08-12T00:00:00Z'))).toBe(8 * 60);
  });
});

describe('past-slot rule', () => {
  // 12:00 UTC = 20:00 Taipei on 2026-08-12.
  const evening = new Date('2026-08-12T12:00:00Z');

  it('treats an earlier date as past', () => {
    expect(isPastSlot('2026-08-11', 9 * 60, evening)).toBe(true);
    expect(isPastDate('2026-08-11', evening)).toBe(true);
  });

  it('treats a later date as future regardless of time of day', () => {
    expect(isPastSlot('2026-08-13', 0, evening)).toBe(false);
    expect(isPastDate('2026-08-13', evening)).toBe(false);
  });

  it('today is not a past date even late in the day', () => {
    expect(isPastDate('2026-08-12', evening)).toBe(false);
  });

  // The regression this rule exists to prevent: judged against the UTC clock the office
  // afternoon still looks like the future, so a 14:00 slot could be booked at 20:00.
  it('treats an earlier slot on today as past, using the Taipei clock', () => {
    expect(isPastSlot('2026-08-12', 14 * 60, evening)).toBe(true);
    // Same instant judged naively against UTC minutes (720) would have said "future".
    expect(14 * 60).toBeGreaterThan(evening.getUTCHours() * 60 + evening.getUTCMinutes());
  });

  it('treats a later slot on today as future', () => {
    expect(isPastSlot('2026-08-12', 21 * 60, evening)).toBe(false);
  });

  it('counts a slot starting exactly now as future, not past', () => {
    expect(isPastSlot('2026-08-12', 20 * 60, evening)).toBe(false);
  });

  it('blocks an early-morning slot that UTC would still call future', () => {
    // 23:30 UTC on the 12th = 07:30 on the 13th in Taipei; 06:00 that day has gone.
    const earlyMorning = new Date('2026-08-12T23:30:00Z');
    expect(isPastSlot('2026-08-13', 6 * 60, earlyMorning)).toBe(true);
    expect(isPastSlot('2026-08-13', 9 * 60, earlyMorning)).toBe(false);
  });
});

describe('time string conversion', () => {
  it('round-trips HH:mm through minutes', () => {
    for (const t of ['00:00', '08:30', '13:05', '23:59']) {
      expect(minToTimeStr(timeStrToMin(t))).toBe(t);
    }
  });

  it('treats an empty time as midnight rather than NaN', () => {
    expect(timeStrToMin('')).toBe(0);
  });
});
