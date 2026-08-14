-- Seed data for Meeting Room Booking System
--
-- Reference data ONLY. No user accounts are seeded here, and none ever should be.
--
-- This file previously carried three accounts ('99999', '71658', '88888') whose
-- password_hash values were unsalted SHA-256 of guessable passwords, with the plaintext
-- spelled out in the comments — in a public repository. Because verifyPasswordChain()
-- still accepts the 64-hex legacy format on purpose (dropping it locks out live
-- accounts), those hashes were working credentials, not dead history: anyone who read
-- the repo could log in. Turnstile stops bots, not somebody who knows the password.
--
-- The only ways an account may come into existence are:
--   - the SUPERADMIN_DEFAULT_PASSWORD-gated bootstrap in src/server/routes/auth.ts, or
--   - an authenticated admin calling POST /api/users, which issues a random one-time
--     password that expires in 15 minutes and must be changed on first use.
--
-- Removing the rows from this file does NOT invalidate anything already in D1. Rotate
-- the credentials in every environment first, then rely on this file staying clean.
INSERT OR IGNORE INTO departments (id, name, phone, sort_order) VALUES
  ('dept-1', '局長室', '5355191', 1),
  ('dept-2', '副局長室', '5355192', 2),
  ('dept-3', '秘書室', '5355193', 3),
  ('dept-4', '企劃科', '5355194', 4),
  ('dept-5', '疾管科', '5355195', 5),
  ('dept-6', '醫政科', '5355196', 6),
  ('dept-7', '藥政科', '5355197', 7),
  ('dept-8', '食品藥物管理科', '5355198', 8),
  ('dept-9', '保健科', '5355199', 9),
  ('dept-10', '檢驗科', '5355200', 10),
  ('dept-11', '人事室', '5355201', 11),
  ('dept-12', '政風室', '5355202', 12),
  ('dept-13', '會計室', '5355203', 13);

INSERT OR IGNORE INTO rooms (id, name, capacity, location, color_key, is_active) VALUES
  ('room-1', '第一會議室', 30, '3 樓 301 室', 'cat-1', 1),
  ('room-2', '第二會議室', 15, '2 樓 202 室', 'cat-2', 1);

INSERT OR IGNORE INTO equipment (id, name, is_active, sort_order) VALUES
  ('eq-1', '單槍投影機', 1, 1),
  ('eq-2', '無線麥克風', 1, 2),
  ('eq-3', '視訊會議設備', 1, 3),
  ('eq-4', '簡報筆', 1, 4),
  ('eq-5', '筆記型電腦', 1, 5),
  ('eq-6', '錄音設備', 1, 6);
