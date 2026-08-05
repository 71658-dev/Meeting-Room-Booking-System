const JWT_SECRET = 'hc_health_jwt_secret_key_2026_v1!';
// Cloudflare Turnstile 免費測試 Secret Key (可於 Cloudflare Dashboard 替換為正式金鑰或經由 env.TURNSTILE_SECRET_KEY 傳入)
const TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';

// 預設使用者清單（當 KV 尚無資料時初始化使用）
const DEFAULT_USERS = [
  { id: '99999', name: '系統管理者', role: 'admin', dept: '行政科', ext: '101', password: 'admin', mustChangePassword: false }
];

// SHA-256 密碼雜湊與加鹽
async function hashPassword(password) {
  if (!password) return '';
  if (/^[a-f0-9]{64}$/i.test(password)) return password;
  const msgBuffer = new TextEncoder().encode(password + '_hc_health_salt_v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 驗證 Cloudflare Turnstile 防機器人 Token
async function verifyTurnstileToken(token, secretKey, clientIP) {
  if (!token) return false;
  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (clientIP && clientIP !== 'global') formData.append('remoteip', clientIP);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });
    const outcome = await res.json();
    return outcome.success === true;
  } catch (e) {
    console.error('Turnstile Verification Error:', e);
    return false;
  }
}

// 簽發 JWT Token (過期時間 8 小時)
async function generateToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 8 * 3600 };

  const base64Url = (str) => btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(fullPayload));

  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataToSign));
  const encodedSignature = base64Url(String.fromCharCode(...new Uint8Array(signature)));

  return `${dataToSign}.${encodedSignature}`;
}

// 驗證 JWT Token
async function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const base64UrlDecode = (str) => {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      return atob(str);
    };

    const sigBytes = new Uint8Array([...base64UrlDecode(encodedSignature)].map(c => c.charCodeAt(0)));
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

// 動態 CORS Headers Helper
function getCorsHeaders(request) {
  const origin = request ? (request.headers.get('Origin') || '*') : '*';
  return {
    'content-type': 'application/json;charset=UTF-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };
}

// 移除使用者物件中的敏感密碼欄位
function sanitizeAppData(data) {
  if (!data || typeof data !== 'object') return {};
  const cloned = JSON.parse(JSON.stringify(data));
  const userKey = 'hc_health_users_v5';
  if (Array.isArray(cloned[userKey])) {
    cloned[userKey] = cloned[userKey].map(u => {
      const { password, ...safeUser } = u;
      return safeUser;
    });
  }
  return cloned;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 處理 CORS OPTIONS 預檢
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(request)
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

        // 防機器人 Turnstile 驗證
        const secretKey = env.TURNSTILE_SECRET_KEY || TURNSTILE_SECRET_KEY;
        const isHuman = await verifyTurnstileToken(turnstileToken, secretKey, clientIP);

        if (!isHuman) {
          return new Response(JSON.stringify({ success: false, message: '防機器人安全驗證未通過或無效，請勾選驗證框後重試！' }), {
            status: 403,
            headers: getCorsHeaders(request)
          });
        }

        // 防暴力破解 Rate Limiting 檢查
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

        const user = users.find(u => u.id === id);
        const inputHash = await hashPassword(password);

        if (!user || inputHash !== await hashPassword(user.password)) {
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
        const token = await generateToken({ id: safeUser.id, role: safeUser.role, dept: safeUser.dept });

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
        const userPayload = await verifyToken(token);

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
        if (Array.isArray(incomingData[userKey])) {
          for (let i = 0; i < incomingData[userKey].length; i++) {
            const u = incomingData[userKey][i];
            const oldU = oldUsersMap.get(u.id);

            if (u.password && u.password.trim() !== '') {
              u.password = await hashPassword(u.password);
            } else if (oldU && oldU.password) {
              u.password = oldU.password;
            } else {
              u.password = await hashPassword('admin');
            }
          }
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