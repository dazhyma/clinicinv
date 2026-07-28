/**
 * Генерация штрихкода и этикетки (§5.5, §5.6, §6.6).
 *
 * Формат — Code 128 (§5.5). Графика векторная (SVG) и генерируется динамически:
 * отдельный растровый файл на каждый объект система хранить не обязана, а вектор
 * гарантирует печать без размытия при любом размере этикетки (§5.6, Q-5).
 *
 * Под графикой печатается человекочитаемая строка внутреннего кода (§5.5).
 * В этикетке (`renderLabelSvg`) она выводится настоящим элементом `<text>`, а не
 * контурами глифов: строка остаётся текстом — её видно в разметке, её читает
 * скринридер, и она не зависит от шрифтовых таблиц bwip-js. В самостоятельном
 * PNG (`renderBarcodePng`) текст рисует bwip-js: растру выбирать не из чего.
 *
 * Модуль исполняется только на сервере (`bwip-js/node`). Константы размеров
 * этикеток вынесены в `label-sizes.ts`, потому что их читает клиентский
 * компонент страницы печати.
 */
import bwipjs from 'bwip-js/node';

export { LABEL_SIZES, DEFAULT_LABEL_SIZE_ID, labelSizeById, MAX_LABEL_COPIES } from './label-sizes';
export type { LabelSize, LabelSizeId } from './label-sizes';

export interface BarcodeSvgOptions {
  /** Масштаб модуля. Больше — толще штрихи, лучше читается сканером. */
  scale?: number;
  /** Высота штрихов, мм. */
  heightMm?: number;
  /** Печатать ли человекочитаемую строку под кодом. По умолчанию да (§5.5). */
  includeText?: boolean;
}

function requireValue(value: string): string {
  const text = value.trim();
  if (!text) throw new Error('Barcode value is empty');
  return text;
}

export function renderBarcodeSvg(value: string, options: BarcodeSvgOptions = {}): string {
  const text = requireValue(value);

  return bwipjs.toSVG({
    bcid: 'code128',
    text,
    scale: options.scale ?? 3,
    height: options.heightMm ?? 12,
    includetext: options.includeText ?? true,
    textxalign: 'center',
    textsize: 8,
  });
}

// --- Этикетка ---------------------------------------------------------------

const VIEW_BOX_PATTERN = /viewBox="0 0 ([\d.]+) ([\d.]+)"/;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

export interface LabelSvgOptions extends BarcodeSvgOptions {
  /** Свободное поле по краям в единицах viewBox (§5.6 — «небольшое свободное пространство»). */
  quietZone?: number;
}

/**
 * Полная этикетка: штрихкод плюс человекочитаемая строка под ним (§5.5, §5.6).
 *
 * Возвращается один самодостаточный SVG — его и показывает страница печати, и
 * отдаёт кнопка Download SVG. Векторная разметка масштабируется до любого
 * размера этикетки без потери резкости; `preserveAspectRatio` по умолчанию
 * вписывает содержимое в отведённую область, поэтому пропорции штрихкода не
 * искажаются даже при узкой этикетке.
 */
export function renderLabelSvg(value: string, options: LabelSvgOptions = {}): string {
  const text = requireValue(value);
  const inner = renderBarcodeSvg(text, { ...options, includeText: false });

  const match = VIEW_BOX_PATTERN.exec(inner);
  if (!match) throw new Error('Unexpected barcode SVG: no viewBox');
  const barWidth = Number(match[1]);
  const barHeight = Number(match[2]);

  const quietZone = options.quietZone ?? Math.round(barWidth * 0.03);
  const fontSize = Math.max(12, Math.round(barWidth * 0.055));
  const textBlock = Math.round(fontSize * 1.5);

  const width = barWidth + quietZone * 2;
  const height = barHeight + quietZone * 2 + textBlock;

  // Вложенный <svg> с явными x/y/width/height: без размеров он растянулся бы
  // на весь внешний viewBox.
  const placed = inner.replace(
    '<svg ',
    `<svg x="${quietZone}" y="${quietZone}" width="${barWidth}" height="${barHeight}" `,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"`,
    ` role="img" aria-label="Barcode ${escapeXml(text)}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    placed,
    `<text x="${width / 2}" y="${height - quietZone}"`,
    ` text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"`,
    ` font-size="${fontSize}" letter-spacing="${Math.round(fontSize * 0.08)}" fill="#000000">`,
    escapeXml(text),
    '</text>',
    '</svg>',
  ].join('');
}

// --- PNG (§5.6, опция Download PNG) -----------------------------------------

export interface BarcodePngOptions {
  /** Масштаб растра. 6 ≈ 300 dpi для этикетки шириной 62 мм. */
  scale?: number;
  heightMm?: number;
}

/**
 * PNG-версия этикетки (§5.6, FR-40/FR-41; необходимость — открытый вопрос Q-7).
 *
 * §5.6 прямо требует оставить над штрихкодом небольшое свободное поле, поэтому
 * `paddingtop` больше остальных отступов. Растр не используется на экране и при
 * печати — только для скачивания.
 */
export async function renderBarcodePng(
  value: string,
  options: BarcodePngOptions = {},
): Promise<Buffer> {
  const text = requireValue(value);

  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: options.scale ?? 6,
    height: options.heightMm ?? 14,
    includetext: true,
    textxalign: 'center',
    textsize: 9,
    backgroundcolor: 'FFFFFF',
    // §5.6: свободное поле над штрихкодом.
    paddingtop: 24,
    paddingbottom: 10,
    paddingleft: 10,
    paddingright: 10,
  });
}
