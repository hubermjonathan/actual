import React from 'react';
import type { CSSProperties } from 'react';
import { Trans } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import {
  BalanceWithCarryover,
  CarryoverIndicator,
} from '#components/budget/BalanceWithCarryover';
import {
  CategoryReservationsProvider,
  ReservationsBreakdownSection,
  useCategoryReservationsValue,
} from '#components/budget/CategoryReservationsSection';
import { BalanceMenu } from '#components/budget/envelope/BalanceMenu';
import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { CellValueText } from '#components/spreadsheet/CellValue';
import { useCategory } from '#hooks/useCategory';
import type { Modal as ModalType } from '#modals/modalsSlice';
import { envelopeBudget } from '#spreadsheet/bindings';

type EnvelopeBalanceMenuModalProps = Extract<
  ModalType,
  { name: 'envelope-balance-menu' }
>['options'];

/**
 * Modals render at the app root, outside the budget table's provider, so this
 * one carries its own -- and everything inside reads the same figures the
 * budget row shows.
 */
export function EnvelopeBalanceMenuModal({
  month,
  ...props
}: EnvelopeBalanceMenuModalProps) {
  return (
    <CategoryReservationsProvider month={month} categoryId={props.categoryId}>
      <EnvelopeBalanceMenuModalInner {...props} month={month} />
    </CategoryReservationsProvider>
  );
}

function EnvelopeBalanceMenuModalInner({
  categoryId,
  onCarryover,
  onTransfer,
  onCover,
}: Omit<EnvelopeBalanceMenuModalProps, 'month'> & { month: string }) {
  const defaultMenuItemStyle: CSSProperties = {
    ...styles.mobileMenuItem,
    color: theme.menuItemText,
    borderRadius: 0,
    borderTop: `1px solid ${theme.pillBorder}`,
  };

  const { data: category } = useCategory(categoryId);
  const reservations = useCategoryReservationsValue();

  if (!category) {
    return null;
  }

  return (
    <Modal name="envelope-balance-menu">
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={category.name} shrinkOnOverflow />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View
            style={{
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 20,
            }}
          >
            <Text
              style={{
                fontSize: 17,
                fontWeight: 400,
              }}
            >
              <Trans>Balance</Trans>
            </Text>
            <BalanceWithCarryover
              isDisabled
              shouldInlineGoalStatus
              reservations={reservations}
              carryover={envelopeBudget.catCarryover(categoryId)}
              balance={envelopeBudget.catBalance(categoryId)}
              goal={envelopeBudget.catGoal(categoryId)}
              budgeted={envelopeBudget.catBudgeted(categoryId)}
              longGoal={envelopeBudget.catLongGoal(categoryId)}
              CarryoverIndicator={({ style }) => (
                <CarryoverIndicator
                  style={{
                    width: 15,
                    height: 15,
                    display: 'inline-flex',
                    position: 'relative',
                    ...style,
                  }}
                />
              )}
            >
              {props => (
                <CellValueText
                  {...props}
                  style={{
                    textAlign: 'center',
                    ...styles.veryLargeText,
                  }}
                />
              )}
            </BalanceWithCarryover>
          </View>
          {/* Touch has no hover, so what the desktop shows in a tooltip lives
              here instead. */}
          <ReservationsBreakdownSection />
          <BalanceMenu
            categoryId={categoryId}
            getItemStyle={() => defaultMenuItemStyle}
            onCarryover={onCarryover}
            onTransfer={onTransfer}
            onCover={onCover}
          />
        </>
      )}
    </Modal>
  );
}
