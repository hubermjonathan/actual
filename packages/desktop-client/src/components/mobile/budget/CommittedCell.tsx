import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type { CategoryEntity } from '@actual-app/core/types/models';
import { AutoTextSize } from 'auto-text-size';

import { useCategoryReservations } from '#components/budget/ReservationsContext';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import { getColumnWidth, PILL_STYLE } from './BudgetTable';

type CommittedCellProps = {
  category: CategoryEntity;
  month: string;
  onPress?: () => void;
};

/**
 * The part of a category's balance that already has a job — owed to a future
 * cost, or set aside as this month's allowance.
 *
 * Touch has no hover, so the split between the two lives in the balance menu
 * rather than a tooltip; this cell opens it.
 */
export function CommittedCell({
  category,
  month,
  onPress,
}: CommittedCellProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const columnWidth = getColumnWidth();
  const reservations = useCategoryReservations(month, category.id);

  const committed =
    (reservations?.reserved ?? 0) + (reservations?.allowance ?? 0);

  return (
    <Button
      variant="bare"
      style={{ ...PILL_STYLE, maxWidth: columnWidth }}
      onPress={onPress}
      aria-label={t('Open committed breakdown for {{categoryName}} category', {
        categoryName: category.name,
      })}
    >
      <PrivacyFilter>
        <AutoTextSize
          key={committed}
          as={Text}
          minFontSizePx={6}
          maxFontSizePx={12}
          mode="oneline"
          style={{
            ...styles.tnum,
            maxWidth: columnWidth,
            textAlign: 'right',
            fontSize: 12,
            color:
              reservations?.status === 'behind'
                ? theme.templateNumberUnderFunded
                : reservations?.status === 'funded'
                  ? theme.templateNumberFunded
                  : theme.tableTextSubdued,
          }}
        >
          {format(committed, 'financial')}
        </AutoTextSize>
      </PrivacyFilter>
    </Button>
  );
}
