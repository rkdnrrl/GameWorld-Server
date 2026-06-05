/**
 * 유저 API 키 암호화 — AES-256-GCM.
 *
 * env API_KEY_ENCRYPTION_SECRET = 64자 hex (32바이트).
 * 미설정 시 첫 호출에 에러 throw — 운영자가 setup 강제.
 *
 * 생성: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * 암호화 출력: base64(ciphertext || authTag), base64(iv)
 *   - authTag 16바이트가 ciphertext 끝에 붙음 (verify 용)
 *   - iv 12바이트 (GCM 표준)
 */
const crypto = require('node:crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedSecret = null;
function getSecret() {
  if (cachedSecret) return cachedSecret;
  const hex = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error('API_KEY_ENCRYPTION_SECRET 미설정 또는 길이 오류 (64자 hex 필요). 생성: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  cachedSecret = Buffer.from(hex, 'hex');
  if (cachedSecret.length !== 32) throw new Error('API_KEY_ENCRYPTION_SECRET 디코드 후 32바이트 아님');
  return cachedSecret;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getSecret(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedKey: Buffer.concat([ciphertext, tag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

function decrypt(encryptedKey, iv) {
  const combined = Buffer.from(encryptedKey, 'base64');
  if (combined.length <= TAG_LEN) throw new Error('암호문 너무 짧음');
  const ciphertext = combined.slice(0, combined.length - TAG_LEN);
  const tag = combined.slice(combined.length - TAG_LEN);
  const ivBuf = Buffer.from(iv, 'base64');
  if (ivBuf.length !== IV_LEN) throw new Error('IV 길이 오류');
  const decipher = crypto.createDecipheriv(ALGO, getSecret(), ivBuf);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
