import { useTranslation } from 'react-i18next';

import { AlignedText } from '@actual-app/components/aligned-text';
import type { CSSProperties } from '@actual-app/components/styles';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CategoryReservationsResult } from '@actual-app/core/server/budget/goal-template';

import { useFormat } from '#hooks/useFormat';

export function hasReservationDetail(r: CategoryReservationsResult | null) {
  return !!r && (r.reserved > 0 || r.allowance > 0);
}

export type ReservationsBreakdownProps = {
  reservations: CategoryReservationsResult | null;
  style?: CSSProperties;
};

/**
 * How a category balance divides up.
 *
 * `Reserved` is owed to a future cost. Do not spend it yet. `Allowance` is for
 * this month. You can spend it, because that is its purpose, but it is already
 * promised. The amount that is left is spare.
 */
export function ReservationsBreakdown({
  reservations,
  style,
}: ReservationsBreakdownProps) {
  const { t } = useTranslation();
  const format = useFormat();
  if (!reservations) return null;

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
      {reservations.reserved > 0 && (
        <>
          <AlignedText
            left={t('Reserved')}
            right={format(reservations.reserved, 'financial')}
            rightStyle={styles.tnum}
          />
          {reservations.claims
            .filter(c => c.accrued > 0)
            .sort((a, b) => b.accrued - a.accrued)
            .map(c => (
              <View key={c.name} style={{ paddingLeft: 12, opacity: 0.75 }}>
                <AlignedText
                  left={c.name}
                  right={
                    c.onTrack
                      ? format(c.reserved, 'financial')
                      : `${format(c.reserved, 'financial')} / ${format(
                          c.accrued,
                          'financial',
                        )}`
                  }
                  rightStyle={styles.tnum}
                  style={{
                    color: c.onTrack
                      ? undefined
                      : theme.templateNumberUnderFunded,
                  }}
                />
              </View>
            ))}
        </>
      )}
      {reservations.allowance > 0 && (
        <>
          <AlignedText
            left={t('Allowance')}
            right={format(reservations.allowance, 'financial')}
            rightStyle={styles.tnum}
          />
          {reservations.allowances.map(a => (
            <View key={a.label} style={{ paddingLeft: 12, opacity: 0.75 }}>
              <AlignedText
                left={a.label}
                right={format(a.amount, 'financial')}
                rightStyle={styles.tnum}
              />
            </View>
          ))}
        </>
      )}
      <View
        style={{
          borderTop: `1px solid ${theme.tableBorderSeparator}`,
          marginTop: 6,
          paddingTop: 6,
        }}
      >
        <AlignedText
          left={t('Spare')}
          right={format(reservations.spare, 'financial')}
          rightStyle={styles.tnum}
          style={{ fontWeight: 600 }}
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
