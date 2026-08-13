/**
 * Код врача: чистые функции без обращения к БД и к node:crypto.
 *
 * Вынесено из `codes.ts` намеренно: форму справочника рисует клиентский
 * компонент, и подсказка кода обязана считаться теми же правилами, что и
 * серверная валидация. Дубль этой логики в UI рано или поздно разошёлся бы с
 * сервером и выдал бы «код не проходит валидацию» на подсказанном же значении.
 */

export const DOCTOR_CODE_MIN_LENGTH = 2;
export const DOCTOR_CODE_MAX_LENGTH = 4;
export const CASE_NUMBER_DIGITS = 5;

/**
 * Транслитерация кириллицы: код печатается, диктуется вслух и должен оставаться
 * ASCII, как и остальные коды системы. «Чен» и «Chen» обязаны дать один префикс.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH', З: 'Z',
  И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R',
  С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'KH', Ц: 'TS', Ч: 'CH', Ш: 'SH',
  Щ: 'SCH', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'YU', Я: 'YA',
};

function toLatinLetters(value: string): string {
  return [...value.toUpperCase()]
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join('')
    .replace(/[^A-Z]/g, '');
}

/**
 * Код врача по умолчанию — первые две буквы фамилии (Chen → CH).
 *
 * Значение только ПРЕДЛАГАЕТСЯ: поле формы остаётся редактируемым, потому что у
 * двух врачей фамилии могут начинаться одинаково, и разводить их обязан человек,
 * а не эвристика.
 */
export function suggestDoctorCode(lastName: string): string {
  return toLatinLetters(lastName ?? '').slice(0, DOCTOR_CODE_MIN_LENGTH);
}

export function normalizeDoctorCode(raw: string): string {
  return toLatinLetters(raw ?? '').slice(0, DOCTOR_CODE_MAX_LENGTH);
}

export function isValidDoctorCode(value: string): boolean {
  return new RegExp(`^[A-Z]{${DOCTOR_CODE_MIN_LENGTH},${DOCTOR_CODE_MAX_LENGTH}}$`).test(value);
}

/**
 * Обозначение операции: код врача вплотную к номеру, без разделителя — CH00001.
 *
 * Разбор обратно на части не нужен нигде: врач хранится отдельным полем и
 * снимком. Разделитель не потребовался бы и для однозначности — код врача
 * состоит только из букв A–Z, номер только из цифр, поэтому граница между
 * ними видна и без тире.
 */
export function formatCaseCode(doctorCode: string, value: number): string {
  return `${doctorCode}${String(value).padStart(CASE_NUMBER_DIGITS, '0')}`;
}
