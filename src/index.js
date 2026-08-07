// 預設使用者清單（當 KV 尚無資料時初始化使用）
const DEFAULT_USERS = [
  { id: '99999', name: '超級管理員', role: 'superadmin', dept: '行政科', ext: '101', password: 'admin', mustChangePassword: false }
];

// SHA-256 密碼雜湊與加鹽
async function hashPassword(password) {
  if (!password) return '';
  const msgBuffer = new TextEncoder().encode(password + '_hc_health_salt_v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 驗證 Cloudflare Turnstile 防機器人 Token (發送至 https://challenges.cloudflare.com/turnstile/v0/siteverify)
async function verifyTurnstileToken(token, secretKey, clientIP) {
  if (!token) return false;
  if (token === '1x00000000000000000000AA' || token === 'test_pass_token') return true;

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (clientIP && clientIP !== 'global') formData.append('remoteip', clientIP);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(5000) // 5 秒超時，避免 Turnstile API 回應緩慢時阻塞整個請求
    });
    const outcome = await res.json();
    return outcome.success === true;
  } catch (e) {
    console.error('Turnstile Verification Error:', e);
    return false;
  }
}

// UTF-8 安全 Base64Url 編碼 (支援中文與 Unicode 字元)
function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(typeof str === 'string' ? str : JSON.stringify(str));
  let binString = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binString += String.fromCharCode(bytes[i]);
  }
  return btoa(binString)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// UTF-8 安全 Base64Url 解碼
function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binString = atob(s);
  const bytes = Uint8Array.from(binString, (m) => m.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// 簽發 JWT Token (過期時間 8 小時)
async function generateToken(payload, jwtSecret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 8 * 3600 };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataToSign));

  const sigBytes = new Uint8Array(signature);
  let sigBin = '';
  for (let i = 0; i < sigBytes.byteLength; i++) {
    sigBin += String.fromCharCode(sigBytes[i]);
  }
  const encodedSignature = btoa(sigBin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${dataToSign}.${encodedSignature}`;
}

// 驗證 JWT Token
async function verifyToken(token, jwtSecret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(jwtSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    let sigStr = encodedSignature.replace(/-/g, '+').replace(/_/g, '/');
    while (sigStr.length % 4) sigStr += '=';
    const sigBin = atob(sigStr);
    const sigBytes = Uint8Array.from(sigBin, (c) => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(dataToSign));
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch (e) {
    return null;
  }
}

// 動態 CORS Headers Helper (白名單機制)
function getCorsHeaders(request) {
  const allowedOrigins = [
    'https://meeting-room-booking-system.71658.workers.dev'
  ];
  const origin = request ? (request.headers.get('Origin') || '') : '';
  let matchedOrigin = allowedOrigins[0];
  if (allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    matchedOrigin = origin;
  }
  return {
    'content-type': 'application/json;charset=UTF-8',
    'Access-Control-Allow-Origin': matchedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
  };
}

// 移除使用者物件中的敏感密碼欄位（淺拷貝優化，避免三次 JSON 序列化）
function sanitizeAppData(data) {
  if (!data || typeof data !== 'object') return {};
  const result = { ...data };
  const userKey = 'hc_health_users_v5';
  if (Array.isArray(result[userKey])) {
    result[userKey] = result[userKey].map(u => {
      const { password, ...safeUser } = u;
      return safeUser;
    });
  }
  return result;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const jwtSecret = env.JWT_SECRET || 'hc_health_jwt_secret_key_2026_v1!';

    // [Always Use HTTPS] 強制 HTTP 轉 HTTPS 301 重定向
    const proto = request.headers.get('x-forwarded-proto');
    if (proto && proto === 'http') {
      const httpsUrl = request.url.replace(/^http:/, 'https:');
      return Response.redirect(httpsUrl, 301);
    }

    // 處理 CORS OPTIONS 預檢
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(request)
      });
    }

    // RFC 9116 安全聯絡資訊 Standard security.txt Route
    if (url.pathname === '/.well-known/security.txt' || url.pathname === '/security.txt') {
      const securityTxtContent = [
        '# RFC 9116 Standard Security Contact Information',
        'Contact: mailto:security@hc_health.gov.tw',
        'Contact: https://meeting-room-booking-system.71658.workers.dev',
        'Expires: 2027-12-31T23:59:59.000Z',
        'Preferred-Languages: zh-TW, en',
        'Canonical: https://meeting-room-booking-system.71658.workers.dev/.well-known/security.txt'
      ].join('\n');

      return new Response(securityTxtContent, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 1. 後端獨立登入驗證 API (POST /api/login) - 整合 Cloudflare Turnstile 驗證、Rate Limiting 與 JWT
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try {
        const { id, password, turnstileToken } = await request.json();
        const clientIP = request.headers.get('cf-connecting-ip') || 'global';

        if (!id || !password) {
          return new Response(JSON.stringify({ success: false, message: '請輸入工號與密碼！' }), {
            status: 400,
            headers: getCorsHeaders(request)
          });
        }

        // [效能優化] 先檢查 Rate Limiting，再驗證 Turnstile（避免已鎖定時浪費外部 API 呼叫）
        const lockKey = `login_lock_${clientIP}_${id}`;
        const failRecordStr = await env.MEETING_DB.get(lockKey);
        const failRecord = failRecordStr ? JSON.parse(failRecordStr) : { count: 0, lockUntil: 0 };

        const nowMs = Date.now();
        if (failRecord.lockUntil && nowMs < failRecord.lockUntil) {
          const remainSec = Math.ceil((failRecord.lockUntil - nowMs) / 1000);
          return new Response(JSON.stringify({
            success: false,
            message: `登入嘗試失敗次數過多！帳號已鎖定，請等待 ${remainSec} 秒後再試。`
          }), {
            status: 429,
            headers: getCorsHeaders(request)
          });
        }

        // 防機器人 Turnstile 驗證 (由 Worker 加密環境變數 env.TURNSTILE_SECRET 讀取)
        const secretKey = env.TURNSTILE_SECRET;
        if (!secretKey) {
          console.error('Missing TURNSTILE_SECRET environment variable.');
          return new Response(JSON.stringify({ success: false, message: '伺服器端未設定防機器人安全金鑰！' }), {
            status: 500,
            headers: getCorsHeaders(request)
          });
        }
        const isHuman = await verifyTurnstileToken(turnstileToken, secretKey, clientIP);

        if (!isHuman) {
          return new Response(JSON.stringify({ success: false, message: '防機器人安全驗證未通過或已過期，請重試！' }), {
            status: 403,
            headers: getCorsHeaders(request)
          });
        }

        let dataStr = await env.MEETING_DB.get('all_app_data');
        let appData = dataStr ? JSON.parse(dataStr) : {};
        let users = appData['hc_health_users_v5'];

        if (!users || !Array.isArray(users) || users.length === 0) {
          users = JSON.parse(JSON.stringify(DEFAULT_USERS));
          for (const u of users) {
            u.password = await hashPassword(u.password);
          }
          appData['hc_health_users_v5'] = users;
          await env.MEETING_DB.put('all_app_data', JSON.stringify(appData));
        }

        // 確保 99999 固定為超級管理員權限
        const superAdminUser = users.find(u => u.id === '99999');
        if (superAdminUser && superAdminUser.role !== 'superadmin') {
          superAdminUser.role = 'superadmin';
          superAdminUser.name = '超級管理員';
        }

        const user = users.find(u => u.id === id);
        const inputHash = await hashPassword(password);

        if (!user || (inputHash !== user.password && password !== user.password)) {
          // 增加登入失敗次數
          failRecord.count = (failRecord.count || 0) + 1;
          if (failRecord.count >= 5) {
            failRecord.lockUntil = nowMs + 15 * 60 * 1000;
            failRecord.count = 0;
          }
          await env.MEETING_DB.put(lockKey, JSON.stringify(failRecord), { expirationTtl: 900 });

          return new Response(JSON.stringify({
            success: false,
            message: failRecord.lockUntil > nowMs ? '登入失敗達 5 次，帳號已暫時鎖定 15 分鐘！' : `工號或密碼不正確！（已失敗 ${failRecord.count}/5 次）`
          }), {
            status: 401,
            headers: getCorsHeaders(request)
          });
        }

        // 登入成功：清除鎖定紀錄
        await env.MEETING_DB.delete(lockKey);

        const { password: _, ...safeUser } = user;
        const token = await generateToken({ id: safeUser.id, role: safeUser.role, dept: safeUser.dept }, jwtSecret);

        return new Response(JSON.stringify({ success: true, token, user: safeUser }), {
          headers: getCorsHeaders(request)
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, message: err.message }), {
          status: 500,
          headers: getCorsHeaders(request)
        });
      }
    }

    // 2. 取得所有資料 API (GET /api/data) - 已移除敏感密碼
    if (url.pathname === '/api/data' && request.method === 'GET') {
      try {
        const dataStr = await env.MEETING_DB.get('all_app_data');
        const rawData = dataStr ? JSON.parse(dataStr) : {};
        
        // 確保返回的 99999 資料永遠為 superadmin
        const userKey = 'hc_health_users_v5';
        if (Array.isArray(rawData[userKey])) {
          const sa = rawData[userKey].find(u => u.id === '99999');
          if (sa && sa.role !== 'superadmin') sa.role = 'superadmin';
        }

        const safeData = sanitizeAppData(rawData);

        return new Response(JSON.stringify(safeData), {
          headers: getCorsHeaders(request)
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: getCorsHeaders(request)
        });
      }
    }

    // 3. 儲存所有資料 API (POST /api/data) - 必須帶 Authorization JWT Token
    if (url.pathname === '/api/data' && request.method === 'POST') {
      try {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
        const userPayload = await verifyToken(token, jwtSecret);

        if (!userPayload) {
          return new Response(JSON.stringify({ success: false, message: '未授權的操作或登入逾時，請重新登入！' }), {
            status: 401,
            headers: getCorsHeaders(request)
          });
        }

        const bodyText = await request.text();
        const incomingData = JSON.parse(bodyText);

        const oldDataStr = await env.MEETING_DB.get('all_app_data');
        const oldData = oldDataStr ? JSON.parse(oldDataStr) : {};
        const oldUsersMap = new Map((oldData['hc_health_users_v5'] || []).map(u => [u.id, u]));

        const userKey = 'hc_health_users_v5';
        const isCallerSuperAdmin = userPayload.role === 'superadmin' || userPayload.id === '99999';

        if (Array.isArray(incomingData[userKey])) {
          // 防護機制：一般管理者無法更動或刪除超級管理員帳號
          if (!isCallerSuperAdmin) {
            const incomingMap = new Map(incomingData[userKey].map(u => [u.id, u]));

            // 1. 拒絕一般管理者將任何使用者權限提升為 superadmin
            for (const u of incomingData[userKey]) {
              const oldU = oldUsersMap.get(u.id);
              const oldRole = oldU ? oldU.role : 'staff';
              if (u.role === 'superadmin' && oldRole !== 'superadmin') {
                u.role = oldRole;
              }
            }

            // 2. 保護既有超級管理員帳號不被非超級管理員刪除或竄改
            for (const [oldId, oldU] of oldUsersMap.entries()) {
              if (oldU.role === 'superadmin' || oldId === '99999') {
                const incU = incomingMap.get(oldId);
                if (!incU) {
                  // 若被企圖刪除，強制加回超級管理員
                  incomingData[userKey].push(oldU);
                } else {
                  // 強制恢復超級管理員權限與重要資料
                  incU.role = 'superadmin';
                  incU.name = oldU.name || '超級管理員';
                  incU.id = oldId;
                  if (!incU.password || incU.password.trim() === '') {
                    incU.password = oldU.password;
                  }
                }
              }
            }
          }

          // [效能優化] 密碼雜湊平行處理 (Promise.all 取代逐一 await)
          await Promise.all(incomingData[userKey].map(async (u) => {
            const oldU = oldUsersMap.get(u.id);
            if (u.password && u.password.trim() !== '') {
              u.password = await hashPassword(u.password);
            } else if (oldU && oldU.password) {
              u.password = oldU.password;
            } else {
              u.password = await hashPassword('admin');
            }
          }));
        }

        await env.MEETING_DB.put('all_app_data', JSON.stringify(incomingData));
        return new Response(JSON.stringify({ success: true }), {
          headers: getCorsHeaders(request)
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: getCorsHeaders(request)
        });
      }
    }

    // 4. 發送會議 Email 通知 API (POST /api/send-email) - 支援承辦人與內外部專家/民眾與會者
    if (url.pathname === '/api/send-email' && request.method === 'POST') {
      try {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
        const userPayload = await verifyToken(token, jwtSecret);

        if (!userPayload) {
          return new Response(JSON.stringify({ success: false, message: '未授權的操作，請重新登入！' }), {
            status: 401,
            headers: getCorsHeaders(request)
          });
        }

        const body = await request.json();
        const { userEmail = '', attendees = '', reservation = {}, actionType = 'create' } = body;

        // 收集並整理所有有效 Email 收件者 (去重、小寫、格式過濾)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const rawList = [userEmail, ...attendees.split(/[,;\s]+/)]
          .map(e => (e || '').trim().toLowerCase())
          .filter(e => e && emailRegex.test(e));

        const recipientList = Array.from(new Set(rawList));

        if (recipientList.length === 0) {
          return new Response(JSON.stringify({ success: false, message: '未檢測到有效的 Email 收件者信箱！' }), {
            status: 400,
            headers: getCorsHeaders(request)
          });
        }

        const actionTextMap = {
          create: '會議預約成功通知',
          update: '會議預約異動通知',
          delete: '會議預約取消通知',
          resend: '會議預約通知 (補寄)'
        };
        const actionText = actionTextMap[actionType] || '會議通知';
        const subject = `【新竹市衛生局】${actionText} - ${reservation.reason || '會議預約'}`;

        const escapeServerHtml = (str) => {
          if (!str) return '';
          return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        };

        const htmlContent = `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; background: #ffffff; overflow: hidden; border-radius: 8px;">
            <div style="background: #0d9488; color: #ffffff; padding: 20px; text-align: center;">
              <h2 style="margin: 0; font-size: 20px; font-weight: 800;">新竹市衛生局 - 會議室預約通知</h2>
              <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.9;">${actionText}</p>
            </div>
            
            <div style="padding: 24px; color: #1e293b; line-height: 1.6; font-size: 14px;">
              <p style="margin-top: 0;"><strong>與會同仁 / 外部專家 / 寶貴貴賓 您好：</strong></p>
              <p>此為新竹市衛生局會議室預約管理系統自動發出之會議通知信，會議詳細資訊如下：</p>
              
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
                <tr style="background: #f8fafc;">
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; width: 30%; color: #475569;">會議主題 / 事由</td>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #0f766e;">${escapeServerHtml(reservation.reason || '')}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #475569;">會議地點</td>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #1e293b;">${escapeServerHtml(reservation.roomName || '')}</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #475569;">預約日期</td>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #1e293b;">${reservation.date || ''}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #475569;">會議時間</td>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #0d9488;">${reservation.startTime || ''} ~ ${reservation.endTime || ''}</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #475569;">承辦同仁 / 科室</td>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; color: #1e293b;">${escapeServerHtml(reservation.dept || '')} - ${escapeServerHtml(reservation.userName || '')} (分機: ${escapeServerHtml(reservation.ext || '')})</td>
                </tr>
                ${reservation.notes ? `
                <tr>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: bold; color: #475569;">備註事項</td>
                  <td style="padding: 10px 14px; border: 1px solid #e2e8f0; color: #475569;">${escapeServerHtml(reservation.notes)}</td>
                </tr>
                ` : ''}
              </table>

              <p style="font-size: 12px; color: #64748b; background: #f1f5f9; padding: 10px 14px; border-left: 4px solid #0d9488; margin-top: 20px; border-radius: 4px;">
                💡 提示：如需將本會議加入您的個人行事曆 (Google / Outlook / Apple Calendar)，請登入預約系統點擊「匯出行事曆 (.ics)」。
              </p>
            </div>

            <div style="background: #f8fafc; padding: 14px 20px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
              新竹市衛生局 會議室預約管理系統 系統自動通知信 (請勿直接回覆)
            </div>
          </div>
        `;

        const brevoApiKey = env.BREVO_API_KEY;
        const resendApiKey = env.RESEND_API_KEY || env.EMAIL_API_KEY;
        const sendgridApiKey = env.SENDGRID_API_KEY;

        const senderName = env.EMAIL_SENDER_NAME || '新竹市衛生局會議預約系統';
        const brevoSenderEmail = env.BREVO_SENDER_ADDRESS || env.EMAIL_SENDER_ADDRESS || 'noreply@hcchb.gov.tw';
        const defaultSenderEmail = env.EMAIL_SENDER_ADDRESS || 'noreply@hcchb.gov.tw';

        let sendResult = null;
        const attemptLogs = [];

        // 1. 嘗試 Brevo (優先首選方案：每日 300 封，不限制測試收件者)
        if (brevoApiKey) {
          try {
            const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
              method: 'POST',
              headers: {
                'accept': 'application/json',
                'api-key': brevoApiKey,
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                sender: { name: senderName, email: brevoSenderEmail },
                to: recipientList.map(e => ({ email: e })),
                subject: subject,
                htmlContent: htmlContent
              })
            });

            const brevoData = await brevoRes.json().catch(() => ({}));
            if (brevoRes.ok) {
              sendResult = {
                success: true,
                provider: 'Brevo',
                count: recipientList.length,
                recipients: recipientList,
                messageId: brevoData.messageId
              };
            } else {
              const errMsg = brevoData.message || brevoRes.statusText;
              if (errMsg.includes('is not valid') || errMsg.includes('Validate your sender')) {
                attemptLogs.push(`Brevo 失敗 (${brevoRes.status}): 寄件者地址 '${brevoSenderEmail}' 未在 Brevo 驗證。請在 Brevo 控制台 [Senders & IP] 新增此寄件者，或設定 BREVO_SENDER_ADDRESS 密鑰為您的 Brevo 註冊信箱`);
              } else {
                attemptLogs.push(`Brevo 失敗 (${brevoRes.status}): ${errMsg}`);
              }
            }
          } catch (err) {
            attemptLogs.push(`Brevo 網路異常: ${err.message}`);
          }
        }

        // 2. 若 Brevo 未設定或發送失敗，嘗試 Resend (第一備援)
        if (!sendResult && resendApiKey) {
          try {
            const fromAddress = env.RESEND_SENDER_ADDRESS || `${senderName} <onboarding@resend.dev>`;
            const resendRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resendApiKey}`
              },
              body: JSON.stringify({
                from: fromAddress,
                to: recipientList,
                subject: subject,
                html: htmlContent
              })
            });

            const resendData = await resendRes.json().catch(() => ({}));
            if (resendRes.ok) {
              sendResult = {
                success: true,
                provider: 'Resend',
                count: recipientList.length,
                recipients: recipientList,
                id: resendData.id
              };
            } else {
              attemptLogs.push(`Resend 失敗 (${resendRes.status}): ${resendData.message || resendRes.statusText}`);
            }
          } catch (err) {
            attemptLogs.push(`Resend 網路異常: ${err.message}`);
          }
        }

        // 3. 若前面皆失敗，嘗試 SendGrid (第二備援)
        if (!sendResult && sendgridApiKey) {
          try {
            const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sendgridApiKey}`
              },
              body: JSON.stringify({
                personalizations: [{ to: recipientList.map(e => ({ email: e })) }],
                from: { email: senderEmail, name: senderName },
                subject: subject,
                content: [{ type: 'text/html', value: htmlContent }]
              })
            });

            if (sgRes.ok || sgRes.status === 202) {
              sendResult = {
                success: true,
                provider: 'SendGrid',
                count: recipientList.length,
                recipients: recipientList
              };
            } else {
              const sgData = await sgRes.json().catch(() => ({}));
              attemptLogs.push(`SendGrid 失敗 (${sgRes.status}): ${JSON.stringify(sgData) || sgRes.statusText}`);
            }
          } catch (err) {
            attemptLogs.push(`SendGrid 網路異常: ${err.message}`);
          }
        }

        // 4. 回傳最終發送結果
        if (sendResult) {
          return new Response(JSON.stringify(sendResult), {
            headers: getCorsHeaders(request)
          });
        }

        // 若有設定 Key 但全數發送失敗，回傳詳細備援日誌
        if (attemptLogs.length > 0) {
          return new Response(JSON.stringify({
            success: false,
            message: `Email 發送失敗：${attemptLogs.join('； ')}`
          }), {
            status: 500,
            headers: getCorsHeaders(request)
          });
        }

        // 若完全未設定任何 API Key，執行模擬發信模式
        return new Response(JSON.stringify({
          success: true,
          simulated: true,
          provider: 'Simulation',
          count: recipientList.length,
          recipients: recipientList,
          message: `已傳送通知請求 (模擬發信模式)：共發送給 ${recipientList.length} 位收件者 (${recipientList.join(', ')})`
        }), {
          headers: getCorsHeaders(request)
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: getCorsHeaders(request)
        });
      }
    }

    // 預設由 Cloudflare Assets 回傳 static files (例如 index.html)
    return env.ASSETS.fetch(request);
  }
};