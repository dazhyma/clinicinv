/**
 * Доменные ошибки.
 *
 * §14.4 требует конкретных сообщений: «Barcode not found», «Item is inactive»,
 * «Only 2 units remain in inventory», «Operation was already voided».
 * «Something went wrong» и «Error 500» запрещены. Поэтому каждое сообщение
 * формулируется здесь, в домене, а не собирается в UI.
 *
 * Язык сообщений — английский, дословно по формулировкам ТЗ (Q-41).
 */

export const DOMAIN_ERROR_CODES = [
  'BARCODE_NOT_FOUND',
  'ITEM_NOT_FOUND',
  'ITEM_INACTIVE',
  'PACK_NOT_FOUND',
  'PACK_INACTIVE',
  'PACK_EMPTY',
  'INSUFFICIENT_STOCK',
  'OPERATION_NOT_FOUND',
  'OPERATION_NOT_ACTIVE',
  'OPERATION_ALREADY_FINISHED',
  'OPERATION_ALREADY_VOIDED',
  'OPERATION_LINE_NOT_FOUND',
  'NOTHING_TO_UNDO',
  'INVALID_QUANTITY',
  'INVALID_COST',
  'VALIDATION_FAILED',
  'CODE_GENERATION_FAILED',
  'IMMUTABLE_FIELD',
  'FORBIDDEN',
  'NOT_AUTHENTICATED',
  'ACCOUNT_LOCKED',
  'INVALID_CREDENTIALS',
  'COUNT_NOT_FOUND',
  'COUNT_NOT_DRAFT',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export const errors = {
  barcodeNotFound: (barcode?: string) =>
    new DomainError('BARCODE_NOT_FOUND', 'Barcode not found', { barcode }),

  itemNotFound: (itemId?: number) =>
    new DomainError('ITEM_NOT_FOUND', 'Item not found', { itemId }),

  itemInactive: (itemName?: string) =>
    new DomainError(
      'ITEM_INACTIVE',
      itemName ? `Item is inactive: ${itemName}` : 'Item is inactive',
      { itemName },
    ),

  packNotFound: (packId?: number) =>
    new DomainError('PACK_NOT_FOUND', 'Pack not found', { packId }),

  packInactive: (packName?: string) =>
    new DomainError(
      'PACK_INACTIVE',
      packName ? `Pack is inactive: ${packName}` : 'Pack is inactive',
      { packName },
    ),

  packEmpty: (packName?: string) =>
    new DomainError('PACK_EMPTY', 'Pack has no items', { packName }),

  /** §14.4, эталонная формулировка: «Only 2 units remain in inventory». */
  insufficientStock: (remaining: number, itemName?: string) =>
    new DomainError(
      'INSUFFICIENT_STOCK',
      `Only ${remaining} ${remaining === 1 ? 'unit' : 'units'} remain in inventory`,
      { remaining, itemName },
    ),

  operationNotFound: (operationId?: number) =>
    new DomainError('OPERATION_NOT_FOUND', 'Operation not found', { operationId }),

  operationNotActive: (status?: string) =>
    new DomainError('OPERATION_NOT_ACTIVE', 'Operation is not active', { status }),

  operationAlreadyFinished: () =>
    new DomainError('OPERATION_ALREADY_FINISHED', 'Operation was already finished'),

  /** §14.4, эталонная формулировка: «Operation was already voided». */
  operationAlreadyVoided: () =>
    new DomainError('OPERATION_ALREADY_VOIDED', 'Operation was already voided'),

  operationLineNotFound: () =>
    new DomainError('OPERATION_LINE_NOT_FOUND', 'Item line not found in this operation'),

  nothingToUndo: () => new DomainError('NOTHING_TO_UNDO', 'Nothing to undo'),

  invalidQuantity: (message = 'Quantity must be a whole number') =>
    new DomainError('INVALID_QUANTITY', message),

  invalidCost: (message = 'Cost must be a whole number of cents and cannot be negative') =>
    new DomainError('INVALID_COST', message),

  validationFailed: (message: string, details: Record<string, unknown> = {}) =>
    new DomainError('VALIDATION_FAILED', message, details),

  codeGenerationFailed: () =>
    new DomainError('CODE_GENERATION_FAILED', 'Could not generate a unique code, please retry'),

  immutableField: (field: string) =>
    new DomainError('IMMUTABLE_FIELD', `Field "${field}" cannot be changed`, { field }),

  forbidden: (action?: string) =>
    new DomainError(
      'FORBIDDEN',
      action
        ? `You do not have permission to perform this action: ${action}`
        : 'You do not have permission to perform this action',
      { action },
    ),

  notAuthenticated: () => new DomainError('NOT_AUTHENTICATED', 'Please log in to continue'),

  accountLocked: (minutes: number) =>
    new DomainError(
      'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`,
      { minutes },
    ),

  invalidCredentials: () =>
    new DomainError('INVALID_CREDENTIALS', 'Incorrect username or password'),

  countNotFound: () => new DomainError('COUNT_NOT_FOUND', 'Inventory count not found'),

  countNotDraft: (status?: string) =>
    new DomainError('COUNT_NOT_DRAFT', 'This inventory count is already closed', { status }),
};
