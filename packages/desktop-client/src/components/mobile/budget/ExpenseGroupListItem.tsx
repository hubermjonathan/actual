import { useCallback, useMemo } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { GridListItem } from 'react-aria-components';

import { Button } from '@actual-app/components/button';
import { SvgExpandArrow } from '@actual-app/components/icons/v0';
import { SvgCheveronRight } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import type { CSSProperties } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type {
  CategoryEntity,
  CategoryGroupEntity,
} from '@actual-app/core/types/models';
import { css } from '@emotion/css';
import { AutoTextSize } from 'auto-text-size';

import {
  useAllowanceTotal,
  useReservedTotal,
} from '#components/budget/ReservationsContext';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { CellValue } from '#components/spreadsheet/CellValue';
import type { FormatType } from '#hooks/useFormat';
import { useFormat } from '#hooks/useFormat';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { envelopeBudget, trackingBudget } from '#spreadsheet/bindings';

import { BudgetGroupCard } from './BudgetGroupCard';
import {
  getColumnWidth,
  getFrozenColumnStyle,
  ROW_HEIGHT,
  TABLE_WIDTH,
} from './BudgetTable';
import { ExpenseCategoryList } from './ExpenseCategoryList';

type ExpenseGroupListItemProps = ComponentPropsWithoutRef<
  typeof GridListItem<CategoryGroupEntity>
> & {
  month: string;
  showHiddenCategories: boolean;
  onEditCategoryGroup: (id: CategoryGroupEntity['id']) => void;
  onEditCategory: (id: string) => void;
  onBudgetAction: (month: string, action: string, args: unknown) => void;
  isCollapsed: (id: CategoryGroupEntity['id']) => boolean;
  onToggleCollapse: (id: CategoryGroupEntity['id']) => void;
  isHidden: boolean;
};

export function ExpenseGroupListItem({
  onEditCategoryGroup,
  onEditCategory,
  month,
  onBudgetAction,
  showHiddenCategories,
  isCollapsed,
  onToggleCollapse,
  isHidden,
  ...props
}: ExpenseGroupListItemProps) {
  const { value: categoryGroup } = props;

  const categories = useMemo(
    () =>
      !categoryGroup || isCollapsed(categoryGroup.id)
        ? []
        : (categoryGroup.categories?.filter(
            category => !category.hidden || showHiddenCategories,
          ) ?? []),
    [categoryGroup, isCollapsed, showHiddenCategories],
  );

  const shouldHideCategory = useCallback(
    (category: CategoryEntity) => {
      return !!(category.hidden || categoryGroup?.hidden);
    },
    [categoryGroup?.hidden],
  );

  if (!categoryGroup) {
    return null;
  }

  return (
    <GridListItem textValue={categoryGroup.name} {...props}>
      <BudgetGroupCard
        style={{
          marginTop: 4,
          marginBottom: 4,
        }}
      >
        <ExpenseGroupHeader
          categoryGroup={categoryGroup}
          month={month}
          onEditCategoryGroup={onEditCategoryGroup}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
          isHidden={isHidden}
        />

        <ExpenseCategoryList
          categoryGroup={categoryGroup}
          categories={categories}
          month={month}
          onEditCategory={onEditCategory}
          onBudgetAction={onBudgetAction}
          shouldHideCategory={shouldHideCategory}
        />
      </BudgetGroupCard>
    </GridListItem>
  );
}

type ExpenseGroupHeaderProps = {
  categoryGroup: CategoryGroupEntity;
  month: string;
  onEditCategoryGroup: (id: CategoryGroupEntity['id']) => void;
  isCollapsed: (id: CategoryGroupEntity['id']) => boolean;
  onToggleCollapse: (id: CategoryGroupEntity['id']) => void;
  isHidden: boolean;
};

export function ExpenseGroupHeader({
  categoryGroup,
  month,
  onEditCategoryGroup,
  isCollapsed,
  onToggleCollapse,
  isHidden,
}: ExpenseGroupHeaderProps) {
  const backgroundColor = monthUtils.isCurrentMonth(month)
    ? theme.budgetHeaderCurrentMonth
    : theme.budgetHeaderOtherMonth;

  return (
    <View
      data-testid="category-group-row"
      onClick={() => onToggleCollapse(categoryGroup.id)}
      style={{
        cursor: 'pointer',
        width: TABLE_WIDTH,
        height: ROW_HEIGHT,
        borderBottomWidth: 1,
        borderColor: theme.tableBorder,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: isHidden ? 0.5 : undefined,
        backgroundColor,
      }}
    >
      <ExpenseGroupName
        group={categoryGroup}
        onEditCategoryGroup={onEditCategoryGroup}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        backgroundColor={backgroundColor}
      />
      <ExpenseGroupCells group={categoryGroup} month={month} />
    </View>
  );
}

type ExpenseGroupNameProps = {
  group: CategoryGroupEntity;
  onEditCategoryGroup: (id: CategoryGroupEntity['id']) => void;
  isCollapsed: (id: CategoryGroupEntity['id']) => boolean;
  onToggleCollapse: (id: CategoryGroupEntity['id']) => void;
  backgroundColor: string;
};

function ExpenseGroupName({
  group,
  onEditCategoryGroup,
  isCollapsed,
  onToggleCollapse,
  backgroundColor,
}: ExpenseGroupNameProps) {
  const sidebarColumnWidth = getColumnWidth({ isSidebar: true });
  return (
    <View
      style={{
        ...getFrozenColumnStyle(backgroundColor),
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingLeft: 5,
      }}
    >
      {/* Hidden drag button */}
      <Button
        slot="drag"
        style={{
          opacity: 0,
          width: 1,
          height: 1,
          position: 'absolute',
          overflow: 'hidden',
        }}
      />
      <Button
        variant="bare"
        className={css({
          flexShrink: 0,
          color: theme.pageTextSubdued,
          '&[data-pressed]': {
            backgroundColor: 'transparent',
          },
          marginLeft: -5,
        })}
        onPress={() => onToggleCollapse(group.id)}
      >
        <SvgExpandArrow
          width={8}
          height={8}
          style={{
            flexShrink: 0,
            transition: 'transform .1s',
            transform: isCollapsed(group.id) ? 'rotate(-90deg)' : '',
          }}
        />
      </Button>
      <Button
        variant="bare"
        style={{
          maxWidth: sidebarColumnWidth,
        }}
        onPress={() => onEditCategoryGroup(group.id)}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-start',
          }}
        >
          <Text
            style={{
              ...styles.lineClamp(2),
              width: sidebarColumnWidth,
              textAlign: 'left',
              ...styles.smallText,
              fontWeight: '500',
            }}
            data-testid="category-group-name"
          >
            {group.name}
          </Text>
          <SvgCheveronRight
            style={{ flexShrink: 0, color: theme.tableTextSubdued }}
            width={14}
            height={14}
          />
        </View>
      </Button>
    </View>
  );
}

type ExpenseGroupCellsProps = {
  group: CategoryGroupEntity;
  month: string;
};

function ExpenseGroupCells({ group, month }: ExpenseGroupCellsProps) {
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  const format = useFormat();

  const columnWidth = getColumnWidth();

  const categoryIds = useMemo(
    () => (group.categories ?? []).map(c => c.id),
    [group.categories],
  );
  const reserved = useReservedTotal(month, categoryIds) ?? 0;
  const allowance = useAllowanceTotal(month, categoryIds) ?? 0;

  const amountStyle: CSSProperties = {
    ...styles.tnum,
    width: columnWidth,
    fontSize: 12,
    fontWeight: '500',
    paddingLeft: 5,
    textAlign: 'right',
  };

  const budgeted =
    budgetType === 'tracking'
      ? trackingBudget.groupBudgeted(group.id)
      : envelopeBudget.groupBudgeted(group.id);

  const spent =
    budgetType === 'tracking'
      ? trackingBudget.groupSumAmount(group.id)
      : envelopeBudget.groupSumAmount(group.id);

  const balance =
    budgetType === 'tracking'
      ? trackingBudget.groupBalance(group.id)
      : envelopeBudget.groupBalance(group.id);

  const amount = (
    value: number,
    type: FormatType | undefined,
    style?: CSSProperties,
  ) => (
    <PrivacyFilter>
      <AutoTextSize
        key={value}
        as={Text}
        minFontSizePx={6}
        maxFontSizePx={12}
        mode="oneline"
        style={{ ...amountStyle, ...style }}
      >
        {format(value, type)}
      </AutoTextSize>
    </PrivacyFilter>
  );

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
      }}
    >
      <CellValue<'envelope-budget' | 'tracking-budget', 'group-budget'>
        binding={budgeted}
        type="financial"
      >
        {({ type, value }) => amount(value, type)}
      </CellValue>

      <CellValue<'envelope-budget' | 'tracking-budget', 'group-sum-amount'>
        binding={spent}
        type="financial"
      >
        {({ type, value }) => amount(value, type)}
      </CellValue>

      {amount(reserved + allowance, 'financial' as FormatType, {
        color: theme.tableTextSubdued,
      })}

      <CellValue<'envelope-budget' | 'tracking-budget', 'group-leftover'>
        binding={balance}
        type="financial"
      >
        {/* Reserved comes out here as it does on the category rows, so a group
            row sums the figures its categories show. */}
        {({ type, value }) => amount(value - reserved, type)}
      </CellValue>
    </View>
  );
}
