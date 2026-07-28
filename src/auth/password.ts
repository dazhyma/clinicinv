/**
 * Хранение паролей (§3.1, §15, NFR-12).
 *
 * Только argon2id, только необратимый хеш с солью. Пароль в открытом виде
 * не хранится и не логируется нигде.
 */
import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * `Algorithm` в @node-rs/argon2 — ambient const enum, к его значению нельзя
 * обращаться при isolatedModules. Argon2id = 2 по определению библиотеки;
 * тип импортирован, чтобы опечатка в числе не прошла проверку.
 */
const ARGON2ID: Algorithm = 2 as Algorithm;

/**
 * Параметры соответствуют рекомендациям OWASP для argon2id:
 * 19 МиБ памяти, 2 итерации, параллелизм 1.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Хеш заведомо неверного пароля. Используется, когда аккаунт не найден, чтобы
 * время ответа не выдавало существование username.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$0zqz6xwvjPPZ0m3Kk7Z0Ay0lZk8sT7t3n5Lk0Z9zYb0';

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    // Параметры при проверке не передаются: они закодированы в самой строке
    // хеша, и передача других значений привела бы к ложному отказу.
    return await verify(passwordHash, password);
  } catch {
    // Повреждённый или чужого формата хеш — это неуспешная проверка, не 500.
    return false;
  }
}
