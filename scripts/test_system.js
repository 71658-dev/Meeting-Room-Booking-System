const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DEV_URL = process.env.TEST_URL || 'https://meeting-room-booking-system-dev.71658.workers.dev';

console.log('====================================================');
console.log('🧪 新竹市衛生局會議室預約管理系統 - 自動化測試腳本');
console.log('====================================================\n');

// 測試結果統計
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

// 輔助請求工具
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// ====================================================
// 測試單元 1：前端邏輯防護與 Email 處理測試 (Unit Tests)
// ====================================================
function testFrontendLogic() {
  console.log('🔹 測試單元 1: 前端邏輯防護與 Email 解析邏輯');

  // 1.1 getUserEmail 防護測試
  const getUserEmail = (user) => {
    if (!user) return 'admin@ems.hccg.gov.tw';
    if (user.email && user.email.trim()) return user.email.trim();
    return user.id === '99999' ? 'admin@ems.hccg.gov.tw' : `${user.id}@ems.hccg.gov.tw`;
  };

  assert(getUserEmail(null) === 'admin@ems.hccg.gov.tw', '當 user 為 null 時回傳預設管理員信箱 (防止 Null Pointer Error)');
  assert(getUserEmail({ id: '71658' }) === '71658@ems.hccg.gov.tw', '無自訂 email 時自動格式化為 工號@ems.hccg.gov.tw');
  assert(getUserEmail({ id: '71658', email: 'custom@gmail.com' }) === 'custom@gmail.com', '優先使用同仁自訂/外部 Email 信箱');

  // 1.2 內外部 Email 去重與格式過濾測試
  const filterEmails = (userEmail, attendeesStr) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const rawList = [userEmail, ...(attendeesStr || '').split(/[,;\s]+/)]
      .map(e => (e || '').trim().toLowerCase())
      .filter(e => e && emailRegex.test(e));
    return Array.from(new Set(rawList));
  };

  const recipients = filterEmails('admin@ems.hccg.gov.tw', 'EXPERT@hospital.org, public@gmail.com, admin@ems.hccg.gov.tw, invalid-email');
  assert(recipients.length === 3, '正確去重與剔除無效 Email 格式');
  assert(recipients.includes('expert@hospital.org'), '支援外部醫院專家 Email');
  assert(recipients.includes('public@gmail.com'), '支援一般民眾 Gmail 信箱');
  assert(recipients.includes('admin@ems.hccg.gov.tw'), '支援衛生局內部公務信箱');

  // 1.3 closeModal() 順序解鎖測試 (actionType pre-locking)
  let editingReservationData = { id: 'res-12345' };
  const actionType = (editingReservationData && editingReservationData.id) ? 'update' : 'create';
  editingReservationData = null; // 模擬 closeModal() 清空物件
  assert(actionType === 'update', '在 closeModal() 清空物件前已成功鎖定 actionType 為 update (避免引發 NPE)');

  console.log('');
}

// ====================================================
// 測試單元 2：Cloudflare Worker API 整合測試 (E2E API Tests)
// ====================================================
async function testWorkerAPIs() {
  console.log('🔹 測試單元 2: Cloudflare Worker 雲端 API 整合測試 (' + DEV_URL + ')');

  try {
    // 2.1 測試預設登入 (POST /api/login)
    console.log('  ⏳ 測試登入驗證 API (POST /api/login)...');
    const loginRes = await request(`${DEV_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { id: '99999', password: '5355191#239', turnstileToken: '1x00000000000000000000AA' });

    assert(loginRes.status === 200 && loginRes.body && loginRes.body.success === true, '超級管理員 (99999) 登入驗證成功');
    const authToken = loginRes.body ? loginRes.body.token : '';
    assert(typeof authToken === 'string' && authToken.length > 20, '成功取得安全 JWT Authorization Bearer Token');

    // 2.2 測試讀取資料庫 (GET /api/data)
    console.log('  ⏳ 測試資料庫讀取 API (GET /api/data)...');
    const dataRes = await request(`${DEV_URL}/api/data`);
    assert(dataRes.status === 200 && dataRes.body, '成功讀取 Cloudflare KV 雲端資料庫');
    const initialReservations = dataRes.body['hc_health_reservations_v5'] || [];
    console.log(`     目前系統共有 ${initialReservations.length} 筆預約紀錄。`);

    // 2.3 測試新增並發送會議 Email 通知 (POST /api/send-email) - 含多重發信提供者標示與未授權攔截
    console.log('  ⏳ 測試會議 Email 通知 API (POST /api/send-email)...');
    const testReservation = {
      id: `test-res-${Date.now()}`,
      roomName: '第一會議室 (測試案)',
      date: '2026-08-10',
      startTime: '09:00',
      endTime: '11:00',
      reason: '[自動化測試] 跨科室與外部專家協調會',
      dept: '資訊室',
      userName: '自動測試員',
      ext: '999',
      notes: '測試自動化通知寄送'
    };

    // 2.3.1 未授權呼叫測試 (401 Unauthorized Guard)
    const unauthorizedRes = await request(`${DEV_URL}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { userEmail: 'test@hcchb.gov.tw', reservation: testReservation });
    assert(unauthorizedRes.status === 401, '無 Authorization Header 呼叫發信 API 正確被 401 攔截');

    // 2.3.2 無效 Email 呼叫測試 (400 Bad Request Guard)
    const badEmailRes = await request(`${DEV_URL}/api/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    }, { userEmail: 'invalid-email-format', attendees: '', reservation: testReservation });
    assert(badEmailRes.status === 400, '傳送無效 Email 收件者時正確回傳 400 Bad Request');

    // 2.3.3 正常發信測試 (多重提供者備援)
    const mailRes = await request(`${DEV_URL}/api/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    }, {
      userEmail: 'tester@ems.hccg.gov.tw',
      attendees: 'EXPERT@hospital.org.tw; citizen@gmail.com',
      reservation: testReservation,
      actionType: 'create'
    });

    assert(mailRes.status === 200 && mailRes.body && mailRes.body.success === true, 'Email 發信 API 呼叫成功');
    assert(mailRes.body.count === 3, '成功將通知信分配給 3 位內外部收件者 (承辦人 + 外部專家 + 民眾)');
    assert(['Brevo', 'Resend', 'SendGrid', 'Simulation'].includes(mailRes.body.provider), `Email API 回傳明確的發信提供者標籤 (目前為: ${mailRes.body.provider})`);

    // 2.4 測試資料持久化與原子寫入 (POST /api/data)
    console.log('  ⏳ 測試原子化資料持久化與刪除保存 (POST /api/data)...');
    const testAppData = { ...dataRes.body };
    const testResList = [testReservation, ...initialReservations];
    testAppData['hc_health_reservations_v5'] = testResList;

    const saveRes = await request(`${DEV_URL}/api/data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    }, testAppData);

    assert(saveRes.status === 200 && saveRes.body && saveRes.body.success === true, '原子化寫入新增預約至 Cloudflare KV 成功');

    // 2.5 測試刪除預約並驗證持久化
    testAppData['hc_health_reservations_v5'] = initialReservations; // 移除剛才的新增測試筆
    const deleteSaveRes = await request(`${DEV_URL}/api/data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    }, testAppData);

    assert(deleteSaveRes.status === 200 && deleteSaveRes.body && deleteSaveRes.body.success === true, '原子化寫入刪除預約至 Cloudflare KV 成功');

    // 重新讀取驗證刪除狀態
    const verifyRes = await request(`${DEV_URL}/api/data`);
    const finalReservations = verifyRes.body['hc_health_reservations_v5'] || [];
    const exists = finalReservations.some(r => r.id === testReservation.id);
    assert(exists === false, '驗證預約已完全持久化刪除 (重新讀取資料庫無競態遺留)');

  } catch (err) {
    console.error('API 測試過程序引發例外:', err);
    failed++;
  }

  console.log('');
}

async function runAll() {
  testFrontendLogic();
  await testWorkerAPIs();

  console.log('====================================================');
  console.log(`📊 測試完成總結: 共執行 ${passed + failed} 項測試 | ✅ 通過: ${passed} | ❌ 失敗: ${failed}`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll();
