/**
 * §5.5, §5.6, §6.6, §21.1 — генерация штрихкода и этикетки.
 */
import bwipjs from 'bwip-js/node';
import { describe, expect, it } from 'vitest';
import {
  LABEL_SIZES,
  renderBarcodePng,
  renderBarcodeSvg,
  renderInventoryLabelPng,
  renderInventoryLabelSvg,
  renderLabelSvg,
} from '@/domain/barcode';
import { clampCopies, labelSizeById, MAX_LABEL_COPIES } from '@/domain/label-sizes';
import { FIXTURES, makeBasicPack, makeItem, setupTestDb } from './helpers';

/** Ширина и высота PNG лежат в IHDR: байты 16..24 после сигнатуры и длины чанка. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('Штрихкод генерируется только из системного кода', () => {
  it('полный лейбл предмета содержит имя, reference и Item Code', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze, { referenceNumber: 'J467' });

    expect(item.internalCode).toMatch(/^ITM-\d{6}$/);
    expect(item.barcodeValue).toBe(item.internalCode);

    const svg = renderInventoryLabelSvg({
      name: item.name,
      internalCode: item.internalCode,
      referenceNumber: item.referenceNumber,
    });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // §5.5: под графикой — человекочитаемая строка. Именно текст, а не контуры
    // глифов: строка присутствует в разметке и доступна скринридеру.
    expect(svg).toContain(`>${item.internalCode}</text>`);
    expect(svg).toContain('Gauze 4x4 (Ref: J467)');
    expect(svg).toContain(`barcode ${item.internalCode}`);
    // Графика векторная: ни одного растрового вложения.
    expect(svg).not.toContain('data:image');
    expect(svg).toContain('<path');
  });

  it('этикетка пака содержит код пака (§6.6)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const pack = makeBasicPack(ctx, [{ itemId: item.id, quantity: 2 }]);

    expect(pack.internalCode).toMatch(/^PCK-\d{6}$/);
    expect(pack.barcodeValue).toBe(pack.internalCode);

    const svg = renderInventoryLabelSvg({ name: pack.name, internalCode: pack.internalCode });
    expect(svg).toContain(`>${pack.internalCode}</text>`);
    expect(svg).not.toContain(item.internalCode);
  });

  it('разные коды дают разную графику, один и тот же код — идентичную', () => {
    const item = renderLabelSvg('ITM-000127');
    const pack = renderLabelSvg('PCK-000015');

    expect(item).not.toBe(pack);
    // Генерация детерминирована: повторная печать даёт ту же этикетку.
    expect(renderLabelSvg('ITM-000127')).toBe(item);
  });

  it('Code 128 кодирует каждый символ: длинный код даёт более широкую графику', () => {
    const short = /viewBox="0 0 ([\d.]+)/.exec(renderBarcodeSvg('ITM-000001'))!;
    const long = /viewBox="0 0 ([\d.]+)/.exec(renderBarcodeSvg('ITM-000001-EXTRA'))!;

    expect(Number(long[1])).toBeGreaterThan(Number(short[1]));
  });

  it('пустое значение не превращается в пустую этикетку, а отвергается', () => {
    expect(() => renderLabelSvg('   ')).toThrow(/empty/i);
  });

  it('спецсимволы экранируются, а не ломают разметку', () => {
    const svg = renderLabelSvg('ITM-1<&>');
    expect(svg).toContain('ITM-1&lt;&amp;&gt;');
    expect(svg).not.toContain('<&>');
  });
});

describe('Download PNG (§5.6)', () => {
  it('возвращает PNG со свободным полем над штрихкодом', async () => {
    const withPadding = await renderBarcodePng('ITM-000127');

    // Сигнатура PNG.
    expect(withPadding.subarray(1, 4).toString('ascii')).toBe('PNG');

    const padded = pngSize(withPadding);
    expect(padded.width).toBeGreaterThan(0);
    expect(padded.height).toBeGreaterThan(0);

    // §5.6: «над штрихкодом необходимо оставить небольшое свободное
    // пространство». Сравниваем с той же графикой без отступов: прирост по
    // вертикали заметно больше прироста по горизонтали, то есть свободное поле
    // сверху действительно есть, а не только боковые quiet zones.
    const bare = pngSize(
      await bwipjs.toBuffer({
        bcid: 'code128',
        text: 'ITM-000127',
        scale: 6,
        height: 14,
        includetext: true,
        textxalign: 'center',
        textsize: 9,
        backgroundcolor: 'FFFFFF',
      }),
    );

    expect(padded.height - bare.height).toBeGreaterThan(padded.width - bare.width);
  });

  it('растеризует тот же полный лейбл без отдельной barcode-логики', async () => {
    const png = await renderInventoryLabelPng({
      name: 'Gauze 4x4',
      internalCode: 'ITM-000127',
      referenceNumber: 'J467',
    });
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(pngSize(png).width).toBeGreaterThan(0);
  });
});

describe('Размеры этикеток (§5.6)', () => {
  it('пресеты заданы в миллиметрах и выбираются по id', () => {
    expect(LABEL_SIZES.length).toBeGreaterThan(1);
    for (const size of LABEL_SIZES) {
      expect(size.widthMm).toBeGreaterThan(0);
      expect(size.heightMm).toBeGreaterThan(0);
    }
    expect(labelSizeById('small').widthMm).toBe(50);
    // Неизвестный id не роняет страницу печати, а даёт размер по умолчанию.
    expect(labelSizeById('nonexistent')).toEqual(labelSizeById(undefined));
  });

  it('количество копий ограничено разумными пределами (§5.6)', () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(-5)).toBe(1);
    expect(clampCopies(3)).toBe(3);
    expect(clampCopies(9999)).toBe(MAX_LABEL_COPIES);
    expect(clampCopies(Number.NaN)).toBe(1);
  });
});
