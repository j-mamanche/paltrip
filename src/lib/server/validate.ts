import { error } from '@sveltejs/kit';

const VALID_CATEGORIES = ['general', 'comida', 'transporte', 'alojamiento', 'entretenimiento', 'compras', 'otro'];
const VALID_SETTLEMENT_TYPES = ['immediate', 'deferred'];
const MAX_AMOUNT = 100_000_000;

export function validateCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw error(400, 'Código de divisa inválido');
  return value;
}

export function validateExchangeRate(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) throw error(400, 'Tasa de cambio inválida');
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function validateAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw error(400, 'El monto debe ser un número mayor a 0');
  if (n > MAX_AMOUNT) throw error(400, 'El monto no puede superar $100.000.000');
  return Math.round(n * 100) / 100;
}

export function validateSettlementType(value: unknown): 'immediate' | 'deferred' {
  if (!VALID_SETTLEMENT_TYPES.includes(value as string)) throw error(400, 'Tipo de liquidación inválido');
  return value as 'immediate' | 'deferred';
}

export function validateCategory(value: unknown): string {
  if (!VALID_CATEGORIES.includes(value as string)) throw error(400, 'Categoría inválida');
  return value as string;
}

export function validateText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string') throw error(400, `${field} debe ser texto`);
  if (value.trim().length === 0) throw error(400, `${field} no puede estar vacío`);
  if (value.length > maxLength) throw error(400, `${field} no puede superar ${maxLength} caracteres`);
  return value.trim();
}

export function validateOptionalText(value: unknown, maxLength = 200): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw error(400, 'Formato de texto inválido');
  if (value.length > maxLength) throw error(400, `No puede superar ${maxLength} caracteres`);
  return value.trim() || null;
}
