import { errors } from './errors';

export const CENTIML_PER_ML = 100;
export const MICROS_PER_DOLLAR = 1_000_000;
export const MICROS_PER_CENT = 10_000;

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/** Разбор ml с точностью не более 0.01 без использования float. */
export function parseMlToCentiml(input: string | number, field = 'Volume'): number {
  const raw = typeof input === 'number' ? String(input) : input.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw errors.validationFailed(`${field} must be a positive number with at most 2 decimal places`);
  const value = Number.parseInt(match[1]!, 10) * CENTIML_PER_ML
    + Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw errors.validationFailed(`${field} must be greater than 0`);
  }
  return value;
}

export function parseOptionalMlToCentiml(
  input: string | number | null | undefined,
  field = 'Volume',
): number | null {
  if (input == null || String(input).trim() === '') return null;
  return parseMlToCentiml(input, field);
}

/** Для физического остатка 0 ml допустим; расход по-прежнему обязан быть > 0. */
export function parseNonNegativeMlToCentiml(input: string | number, field = 'Volume'): number {
  const raw = typeof input === 'number' ? String(input) : input.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw errors.validationFailed(`${field} must be 0 or more with at most 2 decimal places`);
  }
  const value = Number.parseInt(match[1]!, 10) * CENTIML_PER_ML
    + Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(value)) throw errors.validationFailed(`${field} is too large`);
  return value;
}

export function formatCentiml(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / CENTIML_PER_ML);
  const fraction = (absolute % CENTIML_PER_ML).toString().padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

/** Cost per ml в integer microdollars, рассчитанный из цены и объёма флакона. */
export function vialCostToPerMlMicros(vialCostCents: number, vialVolumeCentiml: number): number {
  if (!Number.isSafeInteger(vialCostCents) || vialCostCents < 0 || vialVolumeCentiml <= 0) {
    throw errors.invalidCost('Vial cost and volume must be valid non-negative values');
  }
  const value = divideHalfUp(
    BigInt(vialCostCents) * BigInt(MICROS_PER_DOLLAR),
    BigInt(vialVolumeCentiml),
  );
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw errors.invalidCost('Calculated cost per ml is too large');
  return number;
}

/** Округление half-up выполняется один раз на уровне строки surgery. */
export function liquidLineTotalCents(amountCentiml: number, costPerMlMicros: number): number {
  if (!Number.isSafeInteger(amountCentiml) || amountCentiml <= 0 ||
      !Number.isSafeInteger(costPerMlMicros) || costPerMlMicros < 0) {
    throw errors.invalidCost('Liquid amount and applied cost must be valid');
  }
  const cents = divideHalfUp(
    BigInt(amountCentiml) * BigInt(costPerMlMicros),
    BigInt(CENTIML_PER_ML * MICROS_PER_CENT),
  );
  const number = Number(cents);
  if (!Number.isSafeInteger(number)) throw errors.invalidCost('Calculated liquid line total is too large');
  return number;
}

export function standardCostToMicros(costCents: number): number {
  return costCents * MICROS_PER_CENT;
}

export function formatCostPerMeasureMicros(micros: number): string {
  const fixed = (micros / MICROS_PER_DOLLAR).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${fixed || '0'}`;
}

/** Денежная величина за ml: до шести десятичных знаков без float. */
export function parseDollarsToMicros(input: string, field = 'Cost'): number {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!match) throw errors.invalidCost(`${field} must be a non-negative amount with at most 6 decimal places`);
  const value = Number.parseInt(match[1]!, 10) * MICROS_PER_DOLLAR
    + Number.parseInt((match[2] ?? '').padEnd(6, '0') || '0', 10);
  if (!Number.isSafeInteger(value)) throw errors.invalidCost(`${field} is too large`);
  return value;
}

export function liquidTotalCentiml(
  unopenedVials: number,
  openVialCentiml: number,
  volumePerVialCentiml: number,
): number {
  return unopenedVials * volumePerVialCentiml + openVialCentiml;
}

export interface LiquidStockState {
  unopenedVials: number;
  openVialCentiml: number;
}

/** Сначала расходует открытый остаток, затем открывает новые флаконы. */
export function consumeLiquidStock(
  state: LiquidStockState,
  volumePerVialCentiml: number,
  amountCentiml: number,
): LiquidStockState {
  const available = liquidTotalCentiml(
    state.unopenedVials,
    state.openVialCentiml,
    volumePerVialCentiml,
  );
  if (amountCentiml <= 0) throw errors.validationFailed('Amount used must be greater than 0 ml');
  if (amountCentiml > available) {
    throw errors.validationFailed(`Only ${formatCentiml(available)} ml is currently available.`);
  }
  if (amountCentiml <= state.openVialCentiml) {
    return { ...state, openVialCentiml: state.openVialCentiml - amountCentiml };
  }

  const remaining = amountCentiml - state.openVialCentiml;
  const fullVials = Math.floor(remaining / volumePerVialCentiml);
  const partial = remaining % volumePerVialCentiml;
  return {
    unopenedVials: state.unopenedVials - fullVials - (partial > 0 ? 1 : 0),
    openVialCentiml: partial > 0 ? volumePerVialCentiml - partial : 0,
  };
}

/** Возвращает объём на склад, сохраняя физическую модель «не более одного open vial». */
export function returnLiquidToStock(
  state: LiquidStockState,
  volumePerVialCentiml: number,
  amountCentiml: number,
): LiquidStockState {
  if (!Number.isSafeInteger(amountCentiml) || amountCentiml <= 0) {
    throw errors.validationFailed('Returned liquid amount must be greater than 0 ml');
  }
  const total = liquidTotalCentiml(
    state.unopenedVials,
    state.openVialCentiml,
    volumePerVialCentiml,
  ) + amountCentiml;
  return {
    unopenedVials: Math.floor(total / volumePerVialCentiml),
    openVialCentiml: total % volumePerVialCentiml,
  };
}
