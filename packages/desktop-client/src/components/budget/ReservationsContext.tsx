import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import type { CategoryReservationsResult } from '@actual-app/core/server/budget/goal-template';
import type { CategoryEntity } from '@actual-app/core/types/models';

import { useFeatureFlag } from '#hooks/useFeatureFlag';

import { MonthsContext } from './MonthsContext';

type ReservationsByCategory = Map<
  CategoryEntity['id'],
  CategoryReservationsResult
>;

const ReservationsContext = createContext<Map<string, ReservationsByCategory>>(
  new Map(),
);

type ReservationsProviderProps = {
  children: ReactNode;
  /**
   * The months to load. The default is the visible months from
   * `MonthsContext`. Mobile has no `MonthsContext`. It shows one month and
   * gives that month directly.
   */
  months?: string[];
};

/**
 * Loads reserved/spare figures for every visible month.
 *
 * Fetched per month rather than per category: a budget with fifty categories
 * across three months would otherwise issue a hundred and fifty requests to
 * render one screen.
 *
 * The server calculates these values on each call, so they follow a change in
 * the balance and there is no cache to clear. The cost is one more request when
 * the visible months change.
 */
export function ReservationsProvider({
  children,
  months: explicitMonths,
}: ReservationsProviderProps) {
  const isGoalTemplatesEnabled = useFeatureFlag('goalTemplatesEnabled');
  const monthsContext = useContext(MonthsContext);
  const months = useMemo(
    () => explicitMonths ?? monthsContext?.months ?? [],
    [explicitMonths, monthsContext?.months],
  );
  const [byMonth, setByMonth] = useState<Map<string, ReservationsByCategory>>(
    new Map(),
  );
  const monthsKey = months.join(',');

  useEffect(() => {
    if (!isGoalTemplatesEnabled) {
      setByMonth(new Map());
      return;
    }

    let mounted = true;
    Promise.all(
      months.map(month =>
        send('budget/get-reservations', { month })
          .then(rows => [month, rows] as [string, CategoryReservationsResult[]])
          // One month failing must not blank the whole table.
          .catch(() => [month, []] as [string, CategoryReservationsResult[]]),
      ),
    ).then(entries => {
      if (!mounted) return;
      setByMonth(
        new Map(
          entries.map(([month, rows]) => [
            month,
            new Map(rows.map(r => [r.categoryId, r])),
          ]),
        ),
      );
    });

    return () => {
      mounted = false;
    };
    // months is rebuilt each render; monthsKey keeps this stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsKey, isGoalTemplatesEnabled]);

  return (
    <ReservationsContext.Provider value={byMonth}>
      {children}
    </ReservationsContext.Provider>
  );
}

/** Reserved/spare for one category in one month, or null if it has none. */
export function useCategoryReservations(
  month: string,
  categoryId: CategoryEntity['id'],
): CategoryReservationsResult | null {
  const byMonth = useContext(ReservationsContext);
  return useMemo(
    () => byMonth.get(month)?.get(categoryId) ?? null,
    [byMonth, month, categoryId],
  );
}

function useFieldTotal(
  month: string,
  categoryIds: Array<CategoryEntity['id']>,
  field: 'reserved' | 'allowance',
): number | null {
  const byMonth = useContext(ReservationsContext);
  return useMemo(() => {
    const forMonth = byMonth.get(month);
    if (!forMonth) return null;
    let total = 0;
    let found = false;
    for (const id of categoryIds) {
      const r = forMonth.get(id);
      if (r) {
        total += r[field];
        found = true;
      }
    }
    return found ? total : null;
  }, [byMonth, month, categoryIds, field]);
}

/** Summed reservations across the given categories, for group rows. */
export function useReservedTotal(
  month: string,
  categoryIds: Array<CategoryEntity['id']>,
): number | null {
  return useFieldTotal(month, categoryIds, 'reserved');
}

/** Summed allowance money across the given categories, for group rows. */
export function useAllowanceTotal(
  month: string,
  categoryIds: Array<CategoryEntity['id']>,
): number | null {
  return useFieldTotal(month, categoryIds, 'allowance');
}
