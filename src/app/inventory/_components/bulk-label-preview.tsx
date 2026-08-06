'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ResolvedBulkLabels } from '@/actions/item-labels';
import { withBasePath } from '@/base-path';
import {
  LABEL_SHEET_GAP_MM,
  LABEL_SHEET_MARGIN_MM,
  LETTER_HEIGHT_MM,
  LETTER_WIDTH_MM,
} from '@/domain/label-sheet';
import {
  readBulkLabelState,
  requestFromBulkLabelState,
  type BulkLabelSelectionState,
} from './bulk-label-state';

interface ExpandedLabel {
  key: string;
  item: ResolvedBulkLabels['items'][number];
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

export function BulkLabelPreview() {
  const [selection, setSelection] = useState<BulkLabelSelectionState | null>(null);
  const [model, setModel] = useState<ResolvedBulkLabels | null>(null);
  const [error, setError] = useState<string>();
  const [generating, setGenerating] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const stored = readBulkLabelState();
    setSelection(stored);
    if (Object.keys(stored.selected).length === 0) {
      setError('Select at least one item');
      setGenerating(false);
      return;
    }

    const controller = new AbortController();
    void fetch(withBasePath('/api/item-labels/resolve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestFromBulkLabelState(stored)),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Unable to generate label sheet'));
        return response.json() as Promise<ResolvedBulkLabels>;
      })
      .then(setModel)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Unable to generate label sheet');
      })
      .finally(() => setGenerating(false));

    return () => controller.abort();
  }, []);

  const pages = useMemo(() => {
    if (!model) return [];
    const labels: ExpandedLabel[] = [];
    for (const item of model.items) {
      for (let copy = 0; copy < item.copies; copy += 1) {
        labels.push({ key: `${item.id}-${copy}`, item });
      }
    }
    const result: ExpandedLabel[][] = [];
    for (let index = 0; index < labels.length; index += model.layout.labelsPerPage) {
      result.push(labels.slice(index, index + model.layout.labelsPerPage));
    }
    return result;
  }, [model]);

  const downloadPdf = async () => {
    if (!selection) return;
    setDownloading(true);
    setError(undefined);
    try {
      const response = await fetch(withBasePath('/api/item-labels/pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestFromBulkLabelState(selection)),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, 'Unable to generate label sheet PDF'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const now = new Date();
      const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10);
      anchor.download = `inventory-labels-${localDate}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to generate label sheet PDF');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <section className="no-print mb-6">
        <Link
          href="/inventory/labels"
          className="inline-flex text-base text-slate-600 underline underline-offset-4"
        >
          ← Back to Selection
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Label Sheet Preview</h1>

        {generating ? (
          <p role="status" className="mt-5 rounded-xl bg-white p-5 ring-1 ring-slate-200">
            Generating label sheet…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-5 rounded-xl bg-red-50 p-5 text-red-800 ring-1 ring-red-200">
            {error}
          </p>
        ) : null}
        {model ? (
          <div className="mt-5 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-xl font-semibold">
              {model.layout.totalLabels.toLocaleString()} labels ·{' '}
              {model.layout.pageCount.toLocaleString()}{' '}
              {model.layout.pageCount === 1 ? 'page' : 'pages'} · {model.layout.size.label}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl bg-slate-900 px-8 py-4 text-lg font-semibold text-white"
              >
                Print
              </button>
              <button
                type="button"
                onClick={downloadPdf}
                disabled={downloading}
                className="rounded-xl border-2 border-slate-900 bg-white px-8 py-4 text-lg font-semibold disabled:opacity-50"
              >
                {downloading ? 'Generating PDF…' : 'Download PDF'}
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              For accurate label dimensions, print at 100% scale and disable browser headers and
              footers.
            </p>
          </div>
        ) : null}
      </section>

      {model ? (
        <div className="bulk-label-pages flex flex-col items-center gap-6">
          {pages.map((labels, pageIndex) => (
            <section
              key={pageIndex}
              aria-label={`Label sheet page ${pageIndex + 1}`}
              className="bulk-label-page grid shrink-0 content-start bg-white shadow-xl ring-1 ring-slate-300"
              style={{
                width: `${LETTER_WIDTH_MM}mm`,
                height: `${LETTER_HEIGHT_MM}mm`,
                padding: `${LABEL_SHEET_MARGIN_MM}mm`,
                gap: `${LABEL_SHEET_GAP_MM}mm`,
                gridTemplateColumns: `repeat(${model.layout.columns}, ${model.layout.size.widthMm}mm)`,
                gridAutoRows: `${model.layout.size.heightMm}mm`,
                contentVisibility: 'auto',
                containIntrinsicSize: '816px 1056px',
              }}
            >
              {labels.map(({ key, item }) => (
                <article
                  key={key}
                  className="bulk-item-label flex min-h-0 flex-col items-center overflow-hidden bg-white"
                  style={{
                    width: `${model.layout.size.widthMm}mm`,
                    height: `${model.layout.size.heightMm}mm`,
                    padding: '1.5mm',
                  }}
                >
                  <div
                    className="label-graphic min-h-0 w-full flex-1"
                    dangerouslySetInnerHTML={{ __html: item.labelSvg }}
                  />
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}
