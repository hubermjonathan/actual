import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CategoryReservationsResult } from '@actual-app/core/server/budget/goal-template';
import type { CategoryEntity } from '@actual-app/core/types/models';

import {
  hasReservationDetail,
  ReservationsBreakdown,
} from './ReservationsBreakdown';
import {
  ReservationsProvider,
  useCategoryReservations,
} from './ReservationsContext';

const CategoryReservationsContext =
  createContext<CategoryReservationsResult | null>(null);

type CategoryReservationsProviderProps = {
  month: string;
  categoryId: CategoryEntity['id'];
  children: ReactNode;
};

function Resolve({
  month,
  categoryId,
  children,
}: CategoryReservationsProviderProps) {
  const reservations = useCategoryReservations(month, categoryId);
  return (
    <CategoryReservationsContext.Provider value={reservations}>
      {children}
    </CategoryReservationsContext.Provider>
  );
}

/**
 * Reservations for one category, for a surface outside the budget table.
 *
 * Modals render at the app root, outside the provider the table sets up, so
 * this carries its own and narrows the result to the category in hand.
 */
export function CategoryReservationsProvider({
  month,
  categoryId,
  children,
}: CategoryReservationsProviderProps) {
  return (
    <ReservationsProvider months={[month]}>
      <Resolve month={month} categoryId={categoryId}>
        {children}
      </Resolve>
    </ReservationsProvider>
  );
}

/** Portion of the surrounding category's balance owed to known future costs. */
export function useReservedForCategory() {
  return useContext(CategoryReservationsContext)?.reserved ?? 0;
}

/**
 * How the balance divides up: reserved, allowance, and what is spare.
 *
 * Renders nothing when there is nothing claiming the balance — an empty panel
 * would only add a scroll.
 */
export function ReservationsBreakdownSection() {
  const reservations = useContext(CategoryReservationsContext);

  if (!hasReservationDetail(reservations)) {
    return null;
  }

  return (
    <View style={{ borderTop: `1px solid ${theme.pillBorder}`, paddingTop: 4 }}>
      <ReservationsBreakdown reservations={reservations} />
    </View>
  );
}
