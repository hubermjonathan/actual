import { useTranslation } from 'react-i18next';

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

function BreakdownRow({
  label,
  amount,
  bold,
  color,
}: {
  label: string;
  amount: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 16,
        fontWeight: bold ? 600 : undefined,
        color,
      }}
    >
      <Text>{label}</Text>
      <Text style={styles.tnum}>{amount}</Text>
    </View>
  );
}

/**
 * How a category's balance divides up.
 *
 * `Reserved` is owed to a future cost and should not be spent yet. `Allowance`
 * is for this month — spendable, that is its purpose, but already committed.
 * What is left over is spare.
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
          <BreakdownRow
            label={t('Reserved')}
            amount={format(reservations.reserved, 'financial')}
          />
          {reservations.claims
            .filter(c => c.accrued > 0)
            .sort((a, b) => b.accrued - a.accrued)
            .map(c => (
              <View key={c.name} style={{ paddingLeft: 12, opacity: 0.75 }}>
                <BreakdownRow
                  label={c.name}
                  amount={
                    c.onTrack
                      ? format(c.reserved, 'financial')
                      : `${format(c.reserved, 'financial')} / ${format(
                          c.accrued,
                          'financial',
                        )}`
                  }
                  color={
                    c.onTrack ? undefined : theme.templateNumberUnderFunded
                  }
                />
              </View>
            ))}
        </>
      )}
      {reservations.allowance > 0 && (
        <>
          <BreakdownRow
            label={t('Allowance')}
            amount={format(reservations.allowance, 'financial')}
          />
          {reservations.allowances.map(a => (
            <View key={a.label} style={{ paddingLeft: 12, opacity: 0.75 }}>
              <BreakdownRow
                label={a.label}
                amount={format(a.amount, 'financial')}
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
        <BreakdownRow
          label={t('Spare')}
          amount={format(reservations.spare, 'financial')}
          bold
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
