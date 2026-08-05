// 預設使用者清單（當 KV 尚無資料時初始化使用）
const DEFAULT_USERS = [
  { id: '99999', name: '系統管理者', role: 'admin', dept: '行政科', ext: '101', password: 'admin', mustChangePassword: false }
];

// SHA-256 密碼雜湊與加鹽
async function hashPassword(password) {
  if (!password) return '';
  // 如果已經是 64 位 16 進位 SHA-256 Hash，直接返回
  if (/^[a-f0-9]{64}$/i.test(password)) return password;
  const msgBuffer = new TextEncoder().encode(password + '_hc_health_salt_v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 1. 後端獨立登入驗證 API (POST /api/login)
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try {
        const { id, password } = await request.json();
        if (!id || !password) {
          return new Response(JSON.stringify({ success: false, message: '請輸入工號與密碼！' }), {
            status: 400,
            headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
          });
        }

        let dataStr = await env.MEETING_DB.get('all_app_data');
        let appData = dataStr ? JSON.parse(dataStr) : {};
        let users = appData['hc_health_users_v5'];

        // 如果資料庫中還沒有用戶清單，寫入初始化數據並 Hash 密碼
        if (!users || !Array.isArray(users) || users.length === 0) {
          users = JSON.parse(JSON.stringify(DEFAULT_USERS));
          for (const u of users) {
            u.password = await hashPassword(u.password);
          }
          appData['hc_health_users_v5'] = users;
          await env.MEETING_DB.put('all_app_data', JSON.stringify(appData));
        }

        const user = users.find(u => u.id === id);
        if (!user) {
          return new Response(JSON.stringify({ success: false, message: '找不到該工號，請確認輸入是否正確！' }), {
            status: 400,
            headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const inputHash = await hashPassword(password);
        const userStoredHash = await hashPassword(user.password);

        if (inputHash !== userStoredHash) {
          return new Response(JSON.stringify({ success: false, message: '密碼不正確！' }), {
            status: 400,
            headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
          });
        }

        // 登入成功：刪除傳回前端的密碼欄位
        const { password: _, ...safeUser } = user;
        return new Response(JSON.stringify({ success: true, user: safeUser }), {
          headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, message: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
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
          headers: {
            'content-type': 'application/json;charset=UTF-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json;charset=UTF-8' }
        });
      }
    }

    // 3. 儲存所有資料 API (POST /api/data) - 後端 Hash 並保護密碼
    if (url.pathname === '/api/data' && request.method === 'POST') {
      try {
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
          headers: {
            'content-type': 'application/json;charset=UTF-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'content-type': 'application/json;charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 預設由 Cloudflare Assets 回傳 static files (例如 index.html)
    return env.ASSETS.fetch(request);
  }
};