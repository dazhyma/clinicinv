import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { env } from '@/env';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function masterKey(): Buffer {
  const key = Buffer.from(env.patientIdSecret, 'base64');
  if (key.length !== 32) {
    throw new Error('PATIENT_ID_SECRET must contain exactly 32 bytes encoded as base64');
  }
  return key;
}

function deriveKey(purpose: 'encryption' | 'lookup'): Buffer {
  return createHmac('sha256', masterKey()).update(`clinic-patient-id:${purpose}`).digest();
}

/** Шифрует проверенный Patient ID с новым nonce для каждой surgery (D-72). */
export function encryptPatientId(patientId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey('encryption'), iv, {
    authTagLength: TAG_BYTES,
  });
  const ciphertext = Buffer.concat([cipher.update(patientId, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Расшифровывается только на защищённом серверном пути перед показом (D-72). */
export function decryptPatientId(value: string): string {
  const [version, ivPart, tagPart, ciphertextPart, extra] = value.split('.');
  if (version !== VERSION || !ivPart || !tagPart || ciphertextPart === undefined || extra) {
    throw new Error('Stored Patient ID has an invalid encrypted format');
  }
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Stored Patient ID has invalid encryption parameters');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey('encryption'), iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Стабильный keyed token для точного поиска; сам по себе ID не раскрывает (D-72). */
export function patientIdLookup(patientId: string): string {
  return `${VERSION}.${createHmac('sha256', deriveKey('lookup'))
    .update(patientId, 'utf8')
    .digest('base64url')}`;
}
