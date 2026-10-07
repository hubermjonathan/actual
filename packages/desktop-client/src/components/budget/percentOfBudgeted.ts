import { useEnvelopeSheetValue } from '#components/budget/envelope/EnvelopeBudgetComponents';
import { envelopeBudget } from '#spreadsheet/bindings';

/**
 * `total-budgeted` negates its sum, so the sheet holds -3150186 for a month
 * that budgets 31,501.86.
 */
export function useTotalBudgeted(): number {
  return Math.abs(useEnvelopeSheetValue(envelopeBudget.totalBudgeted) ?? 0);
}

export function formatPercentOfTotal(amount: number, total: number): string {
  if (!total) {
    return '--';
  }
  return `${((amount / total) * 100).toFixed(1)}%`;
}
