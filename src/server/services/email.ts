import { Env } from '../types';

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface ReservationEmailPayload {
  id: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  dept: string;
  userName: string;
  ext?: string;
  notes?: string;
}

/**
 * Read-then-write, so two sends racing each other can both observe the same count and
 * both pass — the hourly cap is a budget, not a hard limit, and can be overshot by
 * roughly the number of concurrent requests one user manages to issue.
 *
 * Accepted knowingly, on the same reasoning as the counters in auth/lockout.ts: KV has no
 * atomic increment, and the alternative (a D1 row per user per hour) buys exactness for a
 * control whose job is to blunt bulk sending, not to be precise at the boundary. Anyone
 * revisiting this should change lockout.ts too — the two make the same trade.
 */
export async function checkAndIncrementMailQuota(
  env: Env,
  userId: string,
  count: number
): Promise<boolean> {
  const quotaKey = `mail_quota:${userId}`;
  const currentStr = await env.MEETING_DB.get(quotaKey);
  const current = currentStr ? parseInt(currentStr, 10) : 0;

  if (current + count > 20) {
    return false; // Exceeded limit of 20 per hour
  }

  await env.MEETING_DB.put(quotaKey, (current + count).toString(), { expirationTtl: 3600 });
  return true;
}

// Mail is sent from the agency's own sender domain, so an unrestricted recipient list
// would turn any authenticated account into a phishing relay wearing the agency's
// identity. Recipients are therefore limited to government domains plus whatever
// external domains have been explicitly allowed (external 專家 / 委員 need this).
//
// A rule reads one of two ways, and the leading dot is what says which:
//   '.gov.tw'      → that domain and everything under it (subdomains included)
//   'partner.org'  → that exact domain only
//
// '.gov.tw' is a whole tree of government hosts, so wildcarding it is the intent. An
// operator adding a single external partner almost never means the same thing: writing
// ALLOWED_EMAIL_DOMAINS=partner.org.tw used to also admit evil.partner.org.tw, i.e. any
// hostname the partner's DNS (or an attacker who got a record there) could produce. Exact
// match is therefore the default for configured domains; an operator who genuinely wants
// the subtree opts in by writing the leading dot themselves.
const DEFAULT_ALLOWED_DOMAIN_RULES = ['.gov.tw'];

export function getAllowedRecipientDomains(env: Env): string[] {
  const extra = (env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .map((d) => (d.startsWith('@') ? d.slice(1) : d));

  return [...DEFAULT_ALLOWED_DOMAIN_RULES, ...extra];
}

export function isAllowedRecipient(email: string, allowedRules: string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;

  const domain = email.slice(at + 1).toLowerCase();

  return allowedRules.some((rule) => {
    if (!rule.startsWith('.')) return domain === rule;
    // Anchored at the end, and the leading dot is load-bearing: it is what makes
    // 'notgov.tw' fail against '.gov.tw' while 'ems.hccg.gov.tw' passes. The bare
    // registrable domain ('gov.tw') is matched explicitly.
    return domain === rule.slice(1) || domain.endsWith(rule);
  });
}

export function parseRecipients(
  userEmail: string,
  attendeesStr: string | undefined,
  allowedRules: string[]
): { accepted: string[]; rejected: string[] } {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const candidates = Array.from(
    new Set(
      [userEmail, ...(attendeesStr || '').split(/[,;\s]+/)]
        .map((e) => (e || '').trim().toLowerCase())
        .filter((e) => e && emailRegex.test(e))
    )
  );

  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const email of candidates) {
    if (isAllowedRecipient(email, allowedRules)) accepted.push(email);
    else rejected.push(email);
  }
  return { accepted, rejected };
}

// Every value below is interpolated into an HTML mail body. None of it is trusted:
// reason/notes/userName are free text typed by users.
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendReservationEmail(
  env: Env,
  userId: string,
  userEmail: string,
  attendeesStr: string | undefined,
  reservation: ReservationEmailPayload,
  actionType: 'create' | 'update' | 'cancel' | 'notify' = 'create'
): Promise<{ success: boolean; count: number; provider: string; error?: string; rejected?: string[] }> {
  const { accepted: recipients, rejected } = parseRecipients(
    userEmail,
    attendeesStr,
    getAllowedRecipientDomains(env)
  );

  if (recipients.length === 0) {
    const error = rejected.length
      ? `收件者網域不在允許清單內：${rejected.join('、')}`
      : '無效或未提供收件者 Email';
    return { success: false, count: 0, provider: 'None', error, rejected };
  }

  if (recipients.length > 50) {
    return { success: false, count: 0, provider: 'None', error: '單次收件者不得超過 50 位' };
  }

  // Check hourly quota
  const allowed = await checkAndIncrementMailQuota(env, userId, recipients.length);
  if (!allowed) {
    return { success: false, count: 0, provider: 'QuotaExceeded', error: '每小時寄信額度已滿 (上限 20 封)' };
  }

  const actionTextMap = {
    create: '新增會議室預約通知',
    update: '會議室預約異動通知',
    cancel: '會議室預約取消通知',
    notify: '會議室預約提醒通知',
  };

  // Strip CR/LF from subject material to avoid header injection at providers that
  // build raw MIME from these fields.
  const sanitizeHeader = (v: string) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
  const subject = sanitizeHeader(
    `[新竹市衛生局會議室預約] ${actionTextMap[actionType]} - ${reservation.roomName} (${reservation.date})`
  );
  const senderEmail = env.EMAIL_SENDER_ADDRESS || 'admin@ems.hccg.gov.tw';

  const safe = {
    roomName: escapeHtml(reservation.roomName),
    date: escapeHtml(reservation.date),
    startTime: escapeHtml(reservation.startTime),
    endTime: escapeHtml(reservation.endTime),
    reason: escapeHtml(reservation.reason),
    dept: escapeHtml(reservation.dept),
    userName: escapeHtml(reservation.userName),
    ext: escapeHtml(reservation.ext || '無'),
    notes: reservation.notes ? escapeHtml(reservation.notes) : '',
  };

  const htmlContent = `
    <div style="font-family: 'Noto Sans TC', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; color: #1e293b;">
      <div style="background-color: #0d9488; color: #ffffff; padding: 16px 24px;">
        <h2 style="margin: 0; font-size: 18px;">${escapeHtml(actionTextMap[actionType])}</h2>
      </div>
      <div style="padding: 24px; background-color: #ffffff;">
        <p style="margin-top: 0;">與會同仁 / 專家 您好：</p>
        <p>以下為會議預約詳細資訊：</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr><td style="padding: 8px; font-weight: bold; width: 100px; border-bottom: 1px solid #f1f5f9;">會議地點：</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">${safe.roomName}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #f1f5f9;">會議日期：</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">${safe.date}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #f1f5f9;">會議時間：</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">${safe.startTime} ~ ${safe.endTime}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #f1f5f9;">會議事由：</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">${safe.reason}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #f1f5f9;">登記科室：</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">${safe.dept} (${safe.userName} 分機: ${safe.ext})</td></tr>
          ${safe.notes ? `<tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #f1f5f9;">備註：</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">${safe.notes}</td></tr>` : ''}
        </table>
        <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">此信件由「新竹市衛生局會議室預約管理系統」自動發送，請勿直接回覆。</p>
      </div>
    </div>
  `;

  // Try Provider 1: Brevo
  if (env.BREVO_API_KEY) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: '新竹市衛生局會議室預約系統', email: senderEmail },
          to: recipients.map((r) => ({ email: r })),
          subject,
          htmlContent,
        }),
      });
      if (res.ok) {
        return { success: true, count: recipients.length, provider: 'Brevo' };
      }
    } catch (e) {
      console.warn('Brevo email dispatch failed, falling back:', e);
    }
  }

  // Try Provider 2: Resend
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `新竹市衛生局會議室預約系統 <${senderEmail}>`,
          to: recipients,
          subject,
          html: htmlContent,
        }),
      });
      if (res.ok) {
        return { success: true, count: recipients.length, provider: 'Resend' };
      }
    } catch (e) {
      console.warn('Resend email dispatch failed, falling back:', e);
    }
  }

  // Try Provider 3: SendGrid
  if (env.SENDGRID_API_KEY) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: recipients.map((r) => ({ email: r })) }],
          from: { email: senderEmail, name: '新竹市衛生局會議室預約系統' },
          subject,
          content: [{ type: 'text/html', value: htmlContent }],
        }),
      });
      if (res.ok) {
        return { success: true, count: recipients.length, provider: 'SendGrid' };
      }
    } catch (e) {
      console.warn('SendGrid email dispatch failed, falling back:', e);
    }
  }

  // No provider is configured, or every configured one failed.
  //
  // This reports failure. It used to return `success: true` with provider 'Simulation',
  // which meant an environment missing its API keys — production, on the day it is first
  // deployed — told the user 已寄出 for mail that was never sent, and there was nothing
  // in the UI to distinguish that from a real delivery. Silence about a notification that
  // did not go out is worse than an error about one that did not.
  //
  // Same fail-closed rule TURNSTILE_SECRET follows: unconfigured means refuse and say so,
  // never degrade quietly. The booking itself is already saved by this point — only the
  // notification failed, and the message says exactly that.
  console.warn(
    `[Email] No provider configured or all providers failed. Subject: ${subject}, ` +
      `Recipients: ${recipients.length}`
  );
  return {
    success: false,
    count: 0,
    provider: 'NotConfigured',
    error: '系統尚未設定郵件服務，通知信未寄出（預約本身已儲存），請聯繫系統管理者',
  };
}
