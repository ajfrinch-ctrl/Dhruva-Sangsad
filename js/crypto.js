/* Password hashing — PBKDF2-SHA256. No plain text password is ever stored. */

const ITER = 150000;
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
  return { hash: b64(bits), salt: b64(salt), iter: ITER, algo: 'PBKDF2-SHA256' };
}

export async function verifyPassword(password, record) {
  if (!record || !record.hash || !record.salt) return false;
  const { hash } = await hashPassword(password, record.salt);
  // constant-time-ish compare
  if (hash.length !== record.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
  return diff === 0;
}

export function passwordIssues(pw) {
  const p = String(pw || '');
  const out = [];
  if (p.length < 6) out.push('কমপক্ষে ৬ অক্ষর প্রয়োজন / At least 6 characters required');
  if (/^\s|\s$/.test(p)) out.push('শুরুতে/শেষে স্পেস রাখা যাবে না / No leading or trailing space');
  return out;
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
