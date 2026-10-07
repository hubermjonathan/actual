import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { listen, send } from '@actual-app/core/platform/client/connection';
import type { CategoryReservationsResult } from '@actual-app/core/server/budget/get-reservations';
import * as monthUtils from '@actual-app/core/shared/months';
import type { CategoryEntity } from '@actual-app/core/types/models';
import { debounce } from 'es-toolkit/compat';

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
  months?: string[];
};

export function ReservationsProvider({
  children,
  months: explicitMonths,
}: ReservationsProviderProps) {
  const isGoalTemplatesEnabled = useFeatureFlag('goalTemplatesEnabled');
  const monthsContext = useContext(MonthsContext);
  const months = explicitMonths ?? monthsContext.months;
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
    let requestId = 0;
    const load = () => {
      const id = ++requestId;
      void Promise.all(
        months.map(month =>
          send('budget/get-reservations', { month })
            .then(
              rows => [month, rows] as [string, CategoryReservationsResult[]],
            )
            .catch(() => [month, []] as [string, CategoryReservationsResult[]]),
        ),
      ).then(entries => {
        if (!mounted || id !== requestId) return;
        setByMonth(
          new Map(
            entries.map(([month, rows]) => [
              month,
              new Map(rows.map(r => [r.categoryId, r])),
            ]),
          ),
        );
      });
    };
    load();

    const reload = debounce(load, 100);
    const sheetNames = new Set(months.map(monthUtils.sheetForMonth));
    const unlistenSync = listen('sync-event', event => {
      if (event.type === 'applied' || event.type === 'success') {
        reload();
      }
    });
    const unlistenCells = listen('cells-changed', nodes => {
      if (nodes.some(node => sheetNames.has(node.name.split('!')[0]))) {
        reload();
      }
    });

    return () => {
      mounted = false;
      reload.cancel();
      unlistenSync();
      unlistenCells();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsKey, isGoalTemplatesEnabled]);

  return (
    <ReservationsContext.Provider value={byMonth}>
      {children}
    </ReservationsContext.Provider>
  );
}

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

export function useReservedTotal(
  month: string,
  categoryIds: Array<CategoryEntity['id']>,
): number {
  const byMonth = useContext(ReservationsContext);
  const forMonth = byMonth.get(month);
  return categoryIds.reduce(
    (total, id) => total + (forMonth?.get(id)?.reserved ?? 0),
    0,
  );
}
