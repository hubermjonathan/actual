import { useTranslation } from 'react-i18next';

import { AlignedText } from '@actual-app/components/aligned-text';
import type { CSSProperties } from '@actual-app/components/styles';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CategoryReservationsResult } from '@actual-app/core/server/budget/get-reservations';

import { useFormat } from '#hooks/useFormat';

export function hasReservationDetail(
  r: CategoryReservationsResult | null,
): r is CategoryReservationsResult {
  return !!r && r.claims.length > 0;
}

export type ReservationsBreakdownProps = {
  reservations: CategoryReservationsResult;
  style?: CSSProperties;
};

export function ReservationsBreakdown({
  reservations,
  style,
}: ReservationsBreakdownProps) {
  const { t } = useTranslation();
  const format = useFormat();

  const STATUS_LABEL: Record<string, string> = {
    behind: t('Shortfall of {{amount}}', {
      amount: format(reservations.shortfall, 'financial'),
    }),
    ahead: t('Ahead by {{amount}}', {
      amount: format(reservations.spare, 'financial'),
    }),
    funded: t('Fully funded'),
    onPace: t('On pace'),
  };

  return (
    <View style={{ padding: 10, minWidth: 220, ...style }}>
      <AlignedText
        left={t('Reserved')}
        right={format(reservations.reserved, 'financial')}
        rightStyle={styles.tnum}
      />
      {[...reservations.claims]
        .sort(
          (a, b) =>
            b.accrued - a.accrued || a.nextDate.localeCompare(b.nextDate),
        )
        .map((c, i) => (
          <View
            key={`${c.name}-${c.nextDate}-${i}`}
            style={{ paddingLeft: 12, opacity: 0.75 }}
          >
            <AlignedText
              left={
                c.settledThisMonth
                  ? t('{{name}} (spent)', { name: c.name })
                  : c.name
              }
              right={format(
                c.settledThisMonth ? c.target : c.reserved,
                'financial',
              )}
              rightStyle={styles.tnum}
              style={
                c.settledThisMonth
                  ? { color: theme.pageTextSubdued }
                  : undefined
              }
            />
          </View>
        ))}
      <View
        style={{
          borderTop: `1px solid ${theme.tableBorderSeparator}`,
          marginTop: 6,
          paddingTop: 6,
        }}
      >
        <AlignedText
          left={reservations.spare < 0 ? t('Overspent') : t('Spare')}
          right={format(Math.abs(reservations.spare), 'financial')}
          rightStyle={styles.tnum}
          style={{
            fontWeight: 600,
            color:
              reservations.spare < 0
                ? theme.templateNumberUnderFunded
                : undefined,
          }}
        />
        {reservations.status && (
          <Text
            style={{
              marginTop: 4,
              color:
                reservations.status === 'behind'
                  ? theme.templateNumberUnderFunded
                  : reservations.status === 'funded'
                    ? theme.templateNumberFunded
                    : theme.pageTextSubdued,
            }}
          >
            {STATUS_LABEL[reservations.status]}
          </Text>
        )}
      </View>
    </View>
  );
}
