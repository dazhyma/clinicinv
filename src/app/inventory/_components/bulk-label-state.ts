import {
  DEFAULT_LABEL_SIZE_ID,
  LABEL_SIZES,
} from '@/domain/label-sizes';

export const BULK_LABEL_STORAGE_KEY = 'clinic-bulk-item-labels-v1';

export interface BulkLabelSelectionState {
  selected: Record<string, number>;
  defaultCopies: number;
  sizeId: string;
  filters: {
    query: string;
    category: string;
    location: string;
    availability: string;
    lowStockOnly: boolean;
  };
}

export const EMPTY_BULK_LABEL_STATE: BulkLabelSelectionState = {
  selected: {},
  defaultCopies: 1,
  sizeId: DEFAULT_LABEL_SIZE_ID,
  filters: {
    query: '',
    category: '',
    location: '',
    availability: 'all',
    lowStockOnly: false,
  },
};

export function readBulkLabelState(): BulkLabelSelectionState {
  try {
    const raw = sessionStorage.getItem(BULK_LABEL_STORAGE_KEY);
    if (!raw) return EMPTY_BULK_LABEL_STATE;
    const parsed = JSON.parse(raw) as Partial<BulkLabelSelectionState>;
    const selected =
      parsed.selected && typeof parsed.selected === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.selected).filter(
              ([itemId, copies]) =>
                Number.isSafeInteger(Number(itemId)) &&
                Number(itemId) > 0 &&
                Number.isSafeInteger(copies) &&
                copies >= 1 &&
                copies <= 100,
            ),
          )
        : {};
    const filters =
      parsed.filters && typeof parsed.filters === 'object'
        ? parsed.filters
        : EMPTY_BULK_LABEL_STATE.filters;
    return {
      selected,
      defaultCopies:
        Number.isSafeInteger(parsed.defaultCopies) &&
        Number(parsed.defaultCopies) >= 1 &&
        Number(parsed.defaultCopies) <= 100
          ? Number(parsed.defaultCopies)
          : 1,
      sizeId:
        typeof parsed.sizeId === 'string' &&
        LABEL_SIZES.some((size) => size.id === parsed.sizeId)
          ? parsed.sizeId
          : DEFAULT_LABEL_SIZE_ID,
      filters: {
        query: typeof filters.query === 'string' ? filters.query : '',
        category: typeof filters.category === 'string' ? filters.category : '',
        location: typeof filters.location === 'string' ? filters.location : '',
        availability:
          filters.availability === 'in_stock' ||
          filters.availability === 'out_of_stock'
            ? filters.availability
            : 'all',
        lowStockOnly: filters.lowStockOnly === true,
      },
    };
  } catch {
    return EMPTY_BULK_LABEL_STATE;
  }
}

export function writeBulkLabelState(state: BulkLabelSelectionState): void {
  sessionStorage.setItem(BULK_LABEL_STORAGE_KEY, JSON.stringify(state));
}

export function requestFromBulkLabelState(state: BulkLabelSelectionState) {
  return {
    sizeId: state.sizeId,
    selection: Object.entries(state.selected).map(([itemId, copies]) => ({
      itemId: Number(itemId),
      copies,
    })),
  };
}
