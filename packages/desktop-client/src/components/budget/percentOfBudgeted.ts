import { useEnvelopeSheetValue } from '#components/budget/envelope/EnvelopeBudgetComponents';
import { envelopeBudget } from '#spreadsheet/bindings';

/**
 * The month's total budgeted, as a positive number.
 *
 * `total-budgeted` negates its sum, so the sheet holds -3150186 for a month
 * that budgets 31,501.86. Callers want the magnitude.
 */
export function useTotalBudgeted(): number {
  return Math.abs(useEnvelopeSheetValue(envelopeBudget.totalBudgeted) ?? 0);
}

/**
 * How much of the month a budgeted amount takes, to one decimal place.
 *
 * A month that budgets nothing has no share to report, so it reads as a dash
 * rather than as 0.0%.
 */
export function formatPercentOfTotal(amount: number, total: number): string {
  if (!total) {
    return '--';
  }
  return `${((amount / total) * 100).toFixed(1)}%`;
}

/**
 * The share of the month a category takes.
 *
 * `draft` is the amount being typed, or null when nothing is. The total counts
 * the draft in place of the committed amount, so the figure says what the month
 * would look like if you kept the number you are typing.
 */
export function shareOfBudgeted(
  committed: number,
  draft: number | null,
  total: number,
): string {
  const amount = draft ?? committed;
  return formatPercentOfTotal(amount, total - committed + amount);
}

export function useShareOfBudgeted(
  committed: number,
  draft: number | null,
): string {
  return shareOfBudgeted(committed, draft, useTotalBudgeted());
}
