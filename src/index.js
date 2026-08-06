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

        if (!user || inputHash !== user.password) {
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

    // 預設由 Cloudflare Assets 回傳 static files (例如 index.html)
    return env.ASSETS.fetch(request);
  }
};