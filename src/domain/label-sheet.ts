import type { LabelSize } from './label-sizes';
import { LABEL_SIZES, labelSizeById } from './label-sizes';

export const LETTER_WIDTH_MM = 215.9;
export const LETTER_HEIGHT_MM = 279.4;
export const LABEL_SHEET_MARGIN_MM = 6;
export const LABEL_SHEET_GAP_MM = 2;
export const MAX_BULK_LABEL_ITEMS = 5_000;
export const MAX_BULK_LABELS = 10_000;
export const MAX_COPIES_PER_ITEM = 100;

export interface LabelSheetLayout {
  size: LabelSize;
  columns: number;
  rows: number;
  labelsPerPage: number;
  pageCount: number;
  totalLabels: number;
}

export function isLabelSizeId(value: string): boolean {
  return LABEL_SIZES.some((size) => size.id === value);
}

export function calculateLabelSheetLayout(
  sizeId: string,
  totalLabels: number,
): LabelSheetLayout {
  const size = labelSizeById(sizeId);
  const usableWidth = LETTER_WIDTH_MM - LABEL_SHEET_MARGIN_MM * 2;
  const usableHeight = LETTER_HEIGHT_MM - LABEL_SHEET_MARGIN_MM * 2;
  const columns = Math.max(
    1,
    Math.floor((usableWidth + LABEL_SHEET_GAP_MM) / (size.widthMm + LABEL_SHEET_GAP_MM)),
  );
  const rows = Math.max(
    1,
    Math.floor((usableHeight + LABEL_SHEET_GAP_MM) / (size.heightMm + LABEL_SHEET_GAP_MM)),
  );
  const labelsPerPage = columns * rows;
  return {
    size,
    columns,
    rows,
    labelsPerPage,
    pageCount: totalLabels > 0 ? Math.ceil(totalLabels / labelsPerPage) : 0,
    totalLabels,
  };
}
