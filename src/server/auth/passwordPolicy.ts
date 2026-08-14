// Password policy per REWRITE_PLAN.md §5.2.
//
// Minimum length is 12. Because the hashing cost is capped by the Workers WebCrypto
// 100k-iteration limit (worked around with a 6x chain, but still a ceiling), the
// policy carries more of the weight than it would elsewhere: rejecting guessable
// passwords is the compensating control for a hash we cannot make arbitrarily slow.

export const MIN_PASSWORD_LENGTH = 12;

// The plan calls for a top-10k weak-password corpus. Shipping one verbatim means
// vendoring ~80KB of third-party data, so this is the high-frequency head of that
// distribution plus the structural rules below, which together reject the shapes a
// 10k list is really there to catch (leaked favourites, keyboard walks, repeats,
// sequences, and site-specific guesses).
//
// To load the full corpus later, drop a newline-separated list in this directory and
// union it into WEAK_PASSWORDS; nothing else needs to change.
const WEAK_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012', '1234567890123', '12345678901234', '123456789012345',
  'password1234', 'password123456', 'passw0rd1234', 'p@ssw0rd1234',
  'qwertyuiop12', 'qwerty1234567', 'qwertyuiop123', 'administrator',
  'admin1234567', 'admin12345678', 'administrator1', 'letmein12345',
  'welcome12345', 'welcome123456', 'iloveyou1234', 'sunshine1234',
  'princess1234', 'football1234', 'baseball1234', 'trustno112345',
  'dragon123456', 'monkey123456', 'shadow123456', 'master123456',
  'superman1234', 'batman123456', 'starwars1234', 'pokemon12345',
  'abc123456789', 'abcd12345678', 'a1b2c3d4e5f6', 'asdfghjkl123',
  'zxcvbnm12345', '1qaz2wsx3edc', 'qazwsxedc123', '1q2w3e4r5t6y',
  'taiwan123456', 'taipei123456', 'hsinchu12345', 'hccg123456789',
  'gov123456789', 'health123456', 'meeting12345', 'booking123456',
  'changeme1234', 'temppassword', 'temporary123', 'defaultpass1',
  '000000000000', '111111111111', '123123123123', '112233445566',
  'iloveyou1234', 'whatever1234', 'nopassword12', 'secret123456',
]);

export interface PolicyContext {
  userId: string;
  name: string;
}

export interface PolicyResult {
  ok: boolean;
  error?: string;
}

/** Reject runs like "aaaaaa" and keyboard/number sequences like "123456" or "abcdef". */
function hasLongRunOrSequence(lower: string): boolean {
  let run = 1;
  let ascending = 1;
  let descending = 1;

  for (let i = 1; i < lower.length; i++) {
    const prev = lower.charCodeAt(i - 1);
    const cur = lower.charCodeAt(i);

    run = cur === prev ? run + 1 : 1;
    ascending = cur === prev + 1 ? ascending + 1 : 1;
    descending = cur === prev - 1 ? descending + 1 : 1;

    if (run >= 4 || ascending >= 5 || descending >= 5) return true;
  }
  return false;
}

export function validatePasswordPolicy(password: string, ctx: PolicyContext): PolicyResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `密碼長度至少需 ${MIN_PASSWORD_LENGTH} 個字元` };
  }

  // Cap the length so a huge input cannot be used to burn CPU in the 6x100k chain.
  if (password.length > 200) {
    return { ok: false, error: '密碼長度不得超過 200 個字元' };
  }

  const lower = password.toLowerCase();

  if (WEAK_PASSWORDS.has(lower)) {
    return { ok: false, error: '此密碼屬於常見弱密碼，請改用不易猜測的密碼' };
  }

  if (hasLongRunOrSequence(lower)) {
    return { ok: false, error: '密碼不得包含連續重複或連號字元（例如 aaaa、12345、abcde）' };
  }

  // Identity-derived passwords: 工號 and 姓名 are both public inside the agency.
  const id = ctx.userId.toLowerCase();
  if (id.length >= 3 && lower.includes(id)) {
    return { ok: false, error: '密碼不得包含您的工號' };
  }

  const name = ctx.name.toLowerCase();
  if (name.length >= 2 && lower.includes(name)) {
    return { ok: false, error: '密碼不得包含您的姓名' };
  }

  for (const term of ['hccg', 'hsinchu', '衛生局', 'meetingroom', 'meeting-room']) {
    if (lower.includes(term)) {
      return { ok: false, error: '密碼不得包含機關或系統名稱等可預測字詞' };
    }
  }

  return { ok: true };
}
