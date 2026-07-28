'use client';

import { useState } from 'react';

/**
 * Copy Summary (§12.3, FR-126).
 *
 * Текст сводки приходит с сервера уже собранным (`getOperationSummary().text`):
 * клиент ничего не пересчитывает и не форматирует, поэтому при выключенном
 * `staff_can_see_cost` сумм нет ни в разметке, ни в буфере обмена (D-18).
 *
 * `navigator.clipboard` доступен только в защищённом контексте. Клиника работает
 * по HTTPS (§15), но запасной путь через `document.execCommand('copy')` нужен:
 * молча ничего не скопировать — это ровно то поведение, которое запрещает §14.4.
 */
export function CopySummaryButton({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!legacyCopy(text)) {
        throw new Error('copy command rejected');
      }
      setState('copied');
      window.setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={copy}
        className={
          className ||
          'rounded-xl border-2 border-slate-900 bg-white px-6 py-4 text-lg font-semibold text-slate-900'
        }
      >
        {state === 'copied' ? 'Copied' : 'Copy Summary'}
      </button>

      {state === 'copied' ? (
        <p role="status" className="text-base text-emerald-800">
          Summary copied to the clipboard.
        </p>
      ) : null}

      {state === 'failed' ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-base text-red-800">
            This browser blocked the clipboard. Select the text below and copy it manually.
          </p>
          <textarea
            readOnly
            value={text}
            rows={Math.min(12, text.split('\n').length + 1)}
            className="w-full rounded-lg border border-slate-300 p-3 font-mono text-base"
          />
        </div>
      ) : null}
    </div>
  );
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(area);
  }
}
