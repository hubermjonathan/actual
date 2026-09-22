import { useTranslation } from 'react-i18next';

import { AlignedText } from '@actual-app/components/aligned-text';
import type { CSSProperties } from '@actual-app/components/styles';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CategoryReservationsResult } from '@actual-app/core/server/budget/goal-template';

import { useFormat } from '#hooks/useFormat';

/**
 * Whether there is a breakdown worth showing.
 *
 * Gate on whether the category *has* claims or allowances, not on whether their
 * current amounts are above zero. A fully spent allowance and a claim that
 * accrues nothing this month are both worth seeing, and hiding them makes
 * "spent it all" look identical to "there is none".
 */
export function hasReservationDetail(r: CategoryReservationsResult | null) {
  return !!r && (r.claims.length > 0 || r.allowances.length > 0);
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
      {reservations.claims.length > 0 && (
        <>
          <AlignedText
            left={t('Reserved')}
            right={format(reservations.reserved, 'financial')}
            rightStyle={styles.tnum}
          />
          {[...reservations.claims]
            // Claims accruing nothing this month are still claims. A monthly
            // subscription funds in the month it is due, so it reads 0 until
            // then - and a category that hides it looks like it has no
            // subscriptions at all. Sort those to the bottom, in due order.
            .sort(
              (a, b) =>
                b.accrued - a.accrued || a.nextDate.localeCompare(b.nextDate),
            )
            .map(c => (
              <View key={c.name} style={{ paddingLeft: 12, opacity: 0.75 }}>
                {/*
                  A claim whose bill was paid this month accrues nothing,
                  exactly like one that is not due yet. Saying which is which is
                  what makes a closed month readable: otherwise every
                  reservation that worked looks as though it never existed.
                */}
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
        </>
      )}
      {reservations.allowances.length > 0 && (
        <>
          {/*
            The size of the month's allowance, which is what the lines beneath
            add up to. It used to read `reservations.allowance` - the remainder
            after claims - while the lines beneath read their template totals,
            so the header and its own children disagreed and both were labelled
            "Allowance".

            How much of it is left is deliberately not shown here. For a
            category with no claims it is just the balance again, which the row
            already gives you.
          */}
          <AlignedText
            left={t('Allowance')}
            right={format(reservations.allowanceTotal, 'financial')}
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
        {/*
          A negative spare is an overspend, not a small spare. Claims keep
          their full accrual, so this is the one place the category says it
          cannot cover everything - name it for what it is.
        */}
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
