// Chained PBKDF2 6x100k Password Hashing & Compatibility Verification Chain
// Complies with Cloudflare Workers WebCrypto limit (100k per call)

/** Base64-encode raw bytes. Accepts either a view or a buffer. */
function bytesToB64(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Run `rounds` chained PBKDF2 segments of 100k each over a shared salt. */
async function derivePbkdf2Chain(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  rounds: number
): Promise<Uint8Array<ArrayBuffer>> {
  let material: Uint8Array<ArrayBuffer> = new Uint8Array(new TextEncoder().encode(password));

  for (let i = 0; i < rounds; i++) {
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      key,
      256
    );
    material = new Uint8Array(derived);
  }

  return material;
}

export async function hashPasswordChain(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await derivePbkdf2Chain(password, salt, 6);
  return `pbkdf2c$sha256$6x100000$${bytesToB64(salt)}$${bytesToB64(material)}`;
}

export async function verifyPasswordChain(
  password: string,
  storedHash: string
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (!storedHash || !password) return { ok: false, needsUpgrade: false };

  // 1. pbkdf2c (6x100k) — current format
  if (storedHash.startsWith('pbkdf2c$sha256$6x100000$')) {
    const parts = storedHash.split('$');
    if (parts.length === 5) {
      const salt = b64ToBytes(parts[3]);
      const material = await derivePbkdf2Chain(password, salt, 6);
      const ok = timingSafeEqual(bytesToB64(material), parts[4]);
      return { ok, needsUpgrade: false };
    }
  }

  // 2. pbkdf2 (1x100k) — previous format, upgrade on success
  if (storedHash.startsWith('pbkdf2$sha256$100000$')) {
    const parts = storedHash.split('$');
    if (parts.length === 5) {
      const salt = b64ToBytes(parts[3]);
      const material = await derivePbkdf2Chain(password, salt, 1);
      const ok = timingSafeEqual(bytesToB64(material), parts[4]);
      return { ok, needsUpgrade: ok };
    }
  }

  // 3. v2 dynamic salt (v2$salt$hash)
  if (storedHash.startsWith('v2$')) {
    const parts = storedHash.split('$');
    if (parts.length === 3) {
      const salt = parts[1];
      const targetHash = parts[2];
      const computed = await sha256Hex(salt + password);
      const ok = timingSafeEqual(computed, targetHash);
      return { ok, needsUpgrade: ok };
    }
  }

  // 4. v1 static salt (v1$hash)
  if (storedHash.startsWith('v1$')) {
    const targetHash = storedHash.substring(3);
    const staticSalt = 'hccg_health_booking_v1_salt_2026';
    const computed = await sha256Hex(staticSalt + password);
    const ok = timingSafeEqual(computed, targetHash);
    return { ok, needsUpgrade: ok };
  }

  // 5. Raw SHA-256 hex (64 hex characters)
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const computed = await sha256Hex(password);
    const ok = timingSafeEqual(computed.toLowerCase(), storedHash.toLowerCase());
    return { ok, needsUpgrade: ok };
  }

  return { ok: false, needsUpgrade: false };
}

export async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateRandomToken(lengthBytes = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(lengthBytes));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
