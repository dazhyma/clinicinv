/**
 * Внутренние коды и коды операций.
 *
 * §5.5 / §18.5 / §18.6: код создаётся системой, уникален, постоянен и никогда
 * не переиспользуется. §21.1: два объекта не могут получить одинаковый код.
 *
 * Генерация без гонок: номер выдаётся инкрементом строки `code_sequences`
 * ВНУТРИ той же транзакции BEGIN IMMEDIATE, что и вставка объекта. Два
 * параллельных создания сериализуются писательской блокировкой SQLite, а
 * уникальный индекс на `internal_code` и реестр штрихкодов — вторая линия
 * защиты на уровне БД (AC-1.5, шаг 3).
 *
 * Счётчик, а не COUNT(*): при деактивации объектов счёт по числу записей
 * выдал бы уже занятый номер (Q-14).
 */
import { randomInt } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { DbLike } from '@/db/client';
import { barcodeRegistry, codeSequences } from '@/db/schema';
import { errors } from './errors';

export const ITEM_CODE_PREFIX = 'ITM';
export const PACK_CODE_PREFIX = 'PCK';
export const CODE_DIGITS = 6;

export type CodePrefix = typeof ITEM_CODE_PREFIX | typeof PACK_CODE_PREFIX;

export function formatInternalCode(prefix: CodePrefix, value: number): string {
  return `${prefix}-${String(value).padStart(CODE_DIGITS, '0')}`;
}

const INTERNAL_CODE_PATTERN = new RegExp(`^(ITM|PCK)-\\d{${CODE_DIGITS},}$`);

export function isInternalCode(value: string): boolean {
  return INTERNAL_CODE_PATTERN.test(value.trim().toUpperCase());
}

/**
 * Выдаёт следующий внутренний код. Вызывать только внутри транзакции,
 * иначе гарантия отсутствия гонок теряется.
 */
export function nextInternalCode(tx: DbLike, prefix: CodePrefix): string {
  const row = tx
    .update(codeSequences)
    .set({ nextValue: sql`${codeSequences.nextValue} + 1` })
    .where(eq(codeSequences.prefix, prefix))
    .returning({ nextValue: codeSequences.nextValue })
    .get();

  if (!row) throw errors.codeGenerationFailed();
  // RETURNING в SQLite отдаёт значение ПОСЛЕ обновления, поэтому выданный
  // номер — предыдущий.
  return formatInternalCode(prefix, row.nextValue - 1);
}

/**
 * Алфавит кода операции без визуально неоднозначных символов (0/O, 1/I/L) —
 * код читают и диктуют вслух. 31 символ, 6 позиций ≈ 8.9×10⁸ комбинаций (Q-13).
 */
export const CASE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CASE_CODE_LENGTH = 6;

/**
 * Случайный код операции (§7.3, §18.4).
 *
 * Код НЕ является идентификатором пациента, НЕ выводится из каких-либо данных
 * пациента и не имеет таблицы сопоставления с пациентом. Источник —
 * криптографический ГПСЧ, никаких временных меток и счётчиков в коде нет.
 */
export function generateCaseCode(): string {
  let code = '';
  for (let i = 0; i < CASE_CODE_LENGTH; i += 1) {
    code += CASE_CODE_ALPHABET[randomInt(CASE_CODE_ALPHABET.length)];
  }
  return code;
}

// --- Код операции «CH00001» --------------------------------------------------

/**
 * Правила самого кода врача живут в `doctor-code.ts` без серверных импортов:
 * их же использует клиентская форма справочника, чтобы подсказка и валидация
 * не разошлись.
 */
export {
  CASE_NUMBER_DIGITS,
  DOCTOR_CODE_MAX_LENGTH,
  DOCTOR_CODE_MIN_LENGTH,
  formatCaseCode,
  isValidDoctorCode,
  normalizeDoctorCode,
  suggestDoctorCode,
} from './doctor-code';

/** Ключ счётчика врача в `code_sequences`. Префикс разводит его с ITM/PCK. */
function doctorSequenceKey(doctorCode: string): string {
  return `DOC:${doctorCode}`;
}

/**
 * Следующий номер операции для врача. Вызывать только внутри транзакции.
 *
 * Счётчик живёт отдельно от строки врача намеренно: удалённый и заново
 * заведённый под тем же кодом врач продолжает нумерацию, а не выдаёт CH00001
 * второй раз. Вторая линия защиты — уникальный индекс на `operations.case_code`.
 */
export function nextCaseNumber(tx: DbLike, doctorCode: string): number {
  const key = doctorSequenceKey(doctorCode);
  tx.insert(codeSequences).values({ prefix: key, nextValue: 1 }).onConflictDoNothing().run();

  const row = tx
    .update(codeSequences)
    .set({ nextValue: sql`${codeSequences.nextValue} + 1` })
    .where(eq(codeSequences.prefix, key))
    .returning({ nextValue: codeSequences.nextValue })
    .get();

  if (!row) throw errors.codeGenerationFailed();
  // RETURNING в SQLite отдаёт значение ПОСЛЕ обновления.
  return row.nextValue - 1;
}

/** Нормализация строки, пришедшей со сканера: обрезка и верхний регистр. */
export function normalizeScannedCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export interface BarcodeOwner {
  barcodeValue: string;
  ownerType: 'item' | 'pack';
  ownerId: number;
}

/**
 * Кому принадлежит штрихкод (§18.6: одинаковый код у двух объектов невозможен —
 * реестр это ограничение БД, D-6).
 *
 * Нужен маршруту скачивания этикетки: генератор штрихкодов не должен рисовать
 * произвольную строку из URL — только код, реально выданный системой.
 */
export function findBarcodeOwner(tx: DbLike, code: string): BarcodeOwner | undefined {
  return tx
    .select()
    .from(barcodeRegistry)
    .where(eq(barcodeRegistry.barcodeValue, normalizeScannedCode(code)))
    .get();
}
