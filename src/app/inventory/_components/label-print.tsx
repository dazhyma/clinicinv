'use client';

import Link from 'next/link';
import { useState } from 'react';
import { withBasePath } from '@/base-path';
import {
  LABEL_SIZES,
  MAX_LABEL_COPIES,
  clampCopies,
  labelSizeById,
  DEFAULT_LABEL_SIZE_ID,
} from '@/domain/label-sizes';

/**
 * Страница печати этикетки (§5.6, §6.6, §18.8).
 *
 * Что попадает на бумагу: только этикетки. Всё управление лежит в блоке
 * `no-print` и скрывается правилом `@media print` в globals.css — это скрытие
 * при печати, а не «спрятать кнопки поглубже». Навигационной шапки на странице
 * нет вовсе: она сюда не подключается.
 *
 * Штрихкод — вектор. Разметка SVG приходит с сервера уже готовой и вставляется
 * как есть; растровой картинки нет ни на экране, ни в печати, поэтому этикетка
 * остаётся резкой на любом размере (§5.6 «качественная печать без размытия»).
 *
 * Размеры этикеток клиники не утверждены (§22.5): выбор пресета сделан на самой
 * странице, а не зашит в код одним значением.
 */
export function LabelPrintView({
  title,
  code,
  labelSvg,
  backHref,
  backLabel,
  kindLabel,
}: {
  title: string;
  code: string;
  /** Готовая SVG-разметка этикетки, сгенерированная на сервере. */
  labelSvg: string;
  backHref: string;
  backLabel: string;
  /** «Item» или «Pack» — что именно печатается. */
  kindLabel: string;
}) {
  const [copies, setCopies] = useState(1);
  const [sizeId, setSizeId] = useState<string>(DEFAULT_LABEL_SIZE_ID);
  const size = labelSizeById(sizeId);

  // Обычный <a href> на route handler: Next дописывает префикс только в
  // next/link и router.push, здесь это делаем мы (D-51).
  const downloadBase = withBasePath(`/api/barcode/${encodeURIComponent(code)}`);

  return (
    <>
      <section className="no-print mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
        <Link href={backHref} className="text-base text-slate-600 underline underline-offset-4">
          <span aria-hidden="true">←</span> {backLabel}
        </Link>

        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {kindLabel} label
          </p>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="font-mono text-lg text-slate-600">{code}</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="copies" className="text-base font-medium">
              Copies
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCopies((value) => clampCopies(value - 1))}
                aria-label="One copy fewer"
                className="w-14 rounded-xl border border-slate-300 bg-white text-2xl font-semibold"
              >
                −
              </button>
              <input
                id="copies"
                name="copies"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_LABEL_COPIES}
                value={copies}
                onChange={(event) => setCopies(clampCopies(Number(event.target.value)))}
                className="w-24 rounded-lg border border-slate-300 px-3 py-3 text-center text-lg"
              />
              <button
                type="button"
                onClick={() => setCopies((value) => clampCopies(value + 1))}
                aria-label="One copy more"
                className="w-14 rounded-xl border border-slate-300 bg-white text-2xl font-semibold"
              >
                +
              </button>
            </div>
            <p className="text-sm text-slate-500">1 to {MAX_LABEL_COPIES} identical labels.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="labelSize" className="text-base font-medium">
              Label size
            </label>
            <select
              id="labelSize"
              name="labelSize"
              value={sizeId}
              onChange={(event) => setSizeId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-3 text-lg"
            >
              {LABEL_SIZES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-sm text-slate-500">
              Labels are laid out on the sheet, so a plain sheet works too.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-xl bg-slate-900 px-8 py-4 text-lg font-semibold text-white"
          >
            Print
          </button>
          {/* §5.6: скачивание опционально; PNG отдаётся со свободным полем сверху. */}
          <a
            href={`${downloadBase}?format=svg`}
            download={`${code}.svg`}
            className="rounded-xl border border-slate-300 bg-white px-6 py-4 text-lg font-medium text-slate-800"
          >
            Download SVG
          </a>
          <a
            href={`${downloadBase}?format=png`}
            download={`${code}.png`}
            className="rounded-xl border border-slate-300 bg-white px-6 py-4 text-lg font-medium text-slate-800"
          >
            Download PNG
          </a>
        </div>

        <section className="mt-3 w-full rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="text-xl font-semibold">Label Preview</h2>
          <div className="mt-5 flex min-h-64 items-center justify-center overflow-auto rounded-xl bg-slate-100 p-4 sm:p-8">
            <div
              className="flex w-full max-w-2xl flex-col items-center justify-center overflow-hidden bg-white p-5 shadow-lg ring-1 ring-slate-300"
              style={{ aspectRatio: `${size.widthMm} / ${size.heightMm}` }}
            >
              <div
                className="label-graphic min-h-0 w-full max-w-xl flex-1"
                dangerouslySetInnerHTML={{ __html: labelSvg }}
              />
            </div>
          </div>
        </section>
      </section>

      <div className="label-sheet print-only mx-auto w-full max-w-5xl flex-wrap content-start gap-2 p-4 sm:p-6">
        {Array.from({ length: copies }, (_, index) => (
          <div
            key={index}
            className="label flex flex-col items-center justify-center overflow-hidden bg-white p-[2mm]"
            style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm` }}
          >
            {/*
              Разметка SVG сгенерирована сервером из проверенного barcode_value
              (bwip-js + экранированный текст). Инлайновый вектор, а не <img>:
              так печать гарантированно векторная.
            */}
            <div
              className="label-graphic min-h-0 w-full flex-1"
              dangerouslySetInnerHTML={{ __html: labelSvg }}
            />
          </div>
        ))}
      </div>
    </>
  );
}
