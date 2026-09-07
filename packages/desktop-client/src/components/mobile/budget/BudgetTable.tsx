import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgCheveronRight } from '@actual-app/components/icons/v1';
import { Label } from '@actual-app/components/label';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import type {
  CategoryEntity,
  CategoryGroupEntity,
} from '@actual-app/core/types/models';
import { AutoTextSize } from 'auto-text-size';

import { ReservationsProvider } from '#components/budget/ReservationsContext';
import { MOBILE_NAV_HEIGHT } from '#components/mobile/MobileNavTabs';
import { PullToRefresh } from '#components/mobile/PullToRefresh';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { CellValue } from '#components/spreadsheet/CellValue';
import { SchedulesProvider } from '#hooks/useCachedSchedules';
import type { FormatType } from '#hooks/useFormat';
import { useFormat } from '#hooks/useFormat';
import { useLocalPref } from '#hooks/useLocalPref';
import { useSheetValue } from '#hooks/useSheetValue';
import { useSyncedPref } from '#hooks/useSyncedPref';
import type { Binding } from '#spreadsheet';
import { envelopeBudget, trackingBudget } from '#spreadsheet/bindings';

import { ExpenseGroupList } from './ExpenseGroupList';
import { IncomeGroup } from './IncomeGroup';

export const ROW_HEIGHT = 50;

export const PILL_STYLE: CSSProperties = {
  borderRadius: 16,
  color: theme.pillText,
  backgroundColor: theme.pillBackgroundLight,
};

// The value columns scroll sideways under a frozen category name. At these
// widths the three of them fit on a normal phone and never scroll; the
// mechanism is what lets a very narrow screen show every column instead of
// hiding one behind a toggle.
const SIDEBAR_WIDTH = '35vw';
const COLUMN_WIDTH = '20vw';
const COLUMN_COUNT = 3;

/** Full width of a row: the frozen name column plus every value column. */
export const TABLE_WIDTH = `calc(${SIDEBAR_WIDTH} + ${COLUMN_COUNT} * ${COLUMN_WIDTH})`;

/** Left and right inset of the card a group's rows sit in. */
export const CARD_INSET = 5;

export function getColumnWidth({
  isSidebar = false,
}: {
  isSidebar?: boolean;
} = {}) {
  return isSidebar ? SIDEBAR_WIDTH : COLUMN_WIDTH;
}

/** Style for a cell that stays put while the value columns scroll under it. */
export function getFrozenColumnStyle(backgroundColor: string): CSSProperties {
  return {
    position: 'sticky',
    left: 0,
    zIndex: 1,
    width: SIDEBAR_WIDTH,
    flexShrink: 0,
    backgroundColor,
  };
}

/**
 * Keeps the header and the rows scrolled to the same column.
 *
 * They cannot share one scroll container: the header has to stay put while the
 * rows scroll vertically, so each owns its own horizontal scroller and this
 * mirrors one onto the other. The guard stops the two `scroll` handlers from
 * driving each other in a loop.
 */
function useSyncedColumnScroll() {
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  useEffect(() => {
    const header = headerRef.current;
    const body = bodyRef.current;
    if (!header || !body) return;

    const mirror = (from: HTMLDivElement, to: HTMLDivElement) => () => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      to.scrollLeft = from.scrollLeft;
      // Released on the next frame, after the assignment above has fired the
      // other element's scroll event.
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    };

    const onBodyScroll = mirror(body, header);
    const onHeaderScroll = mirror(header, body);
    body.addEventListener('scroll', onBodyScroll, { passive: true });
    header.addEventListener('scroll', onHeaderScroll, { passive: true });

    // Open on the right-hand end, so Balance -- the figure you check before
    // spending -- is what you see without scrolling. Budgeted starts off screen.
    const end = body.scrollWidth - body.clientWidth;
    body.scrollLeft = end;
    header.scrollLeft = end;

    return () => {
      body.removeEventListener('scroll', onBodyScroll);
      header.removeEventListener('scroll', onHeaderScroll);
    };
  }, []);

  return { headerRef, bodyRef };
}

type ToBudgetProps = {
  toBudget: Binding<'envelope-budget', 'to-budget'>;
  onPress: () => void;
};

function ToBudget({ toBudget, onPress }: ToBudgetProps) {
  const { t } = useTranslation();
  const amount = useSheetValue(toBudget) ?? 0;
  const format = useFormat();
  const sidebarColumnWidth = getColumnWidth({ isSidebar: true });

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        width: sidebarColumnWidth,
      }}
    >
      <Button variant="bare" onPress={onPress}>
        <View>
          <View>
            <AutoTextSize
              as={Label}
              minFontSizePx={6}
              maxFontSizePx={12}
              mode="oneline"
              title={amount < 0 ? t('Overbudgeted') : t('To Budget')}
              style={{
                ...(amount < 0 ? styles.smallText : {}),
                color: theme.formInputText,
                flexShrink: 0,
                textAlign: 'left',
              }}
            />
          </View>
          <CellValue binding={toBudget} type="financial">
            {({ type, value }) => (
              <View>
                <PrivacyFilter>
                  <AutoTextSize
                    key={value}
                    as={Text}
                    minFontSizePx={6}
                    maxFontSizePx={12}
                    mode="oneline"
                    style={{
                      ...styles.tnum,
                      fontSize: 12,
                      fontWeight: '700',
                      color:
                        amount < 0
                          ? theme.toBudgetNegative
                          : amount > 0
                            ? theme.toBudgetPositive
                            : theme.budgetNumberNeutral,
                    }}
                  >
                    {format(value, type)}
                  </AutoTextSize>
                </PrivacyFilter>
              </View>
            )}
          </CellValue>
        </View>
        <SvgCheveronRight
          style={{
            flexShrink: 0,
            color: theme.mobileHeaderTextSubdued,
            marginLeft: 5,
          }}
          width={14}
          height={14}
        />
      </Button>
    </View>
  );
}

type SavedProps = {
  projected: boolean;
  onPress: () => void;
};

function Saved({ projected, onPress }: SavedProps) {
  const { t } = useTranslation();
  const binding = projected
    ? trackingBudget.totalBudgetedSaved
    : trackingBudget.totalSaved;

  const saved = useSheetValue<'tracking-budget', typeof binding>(binding) || 0;
  const format = useFormat();
  const isNegative = saved < 0;
  const sidebarColumnWidth = getColumnWidth({ isSidebar: true });

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        width: sidebarColumnWidth,
      }}
    >
      <Button variant="bare" onPress={onPress}>
        <View style={{ alignItems: 'flex-start' }}>
          {projected ? (
            <View>
              <AutoTextSize
                as={Label}
                minFontSizePx={6}
                maxFontSizePx={12}
                mode="oneline"
                title={t('Projected savings')}
                style={{
                  color: theme.formInputText,
                  textAlign: 'left',
                  fontSize: 12,
                }}
              />
            </View>
          ) : (
            <Label
              title={isNegative ? t('Overspent') : t('Saved')}
              style={{
                color: theme.formInputText,
                textAlign: 'left',
              }}
            />
          )}

          <CellValue<'tracking-budget', typeof binding>
            binding={binding}
            type="financial"
          >
            {({ type, value }) => (
              <View>
                <PrivacyFilter>
                  <AutoTextSize
                    key={value}
                    as={Text}
                    minFontSizePx={6}
                    maxFontSizePx={12}
                    mode="oneline"
                    style={{
                      ...styles.tnum,
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: '700',
                      color: projected
                        ? theme.warningText
                        : isNegative
                          ? theme.errorTextDark
                          : theme.formInputText,
                    }}
                  >
                    {format(value, type)}
                  </AutoTextSize>
                </PrivacyFilter>
              </View>
            )}
          </CellValue>
        </View>
        <SvgCheveronRight
          style={{
            flexShrink: 0,
            color: theme.mobileHeaderTextSubdued,
            marginLeft: 5,
          }}
          width={14}
          height={14}
        />
      </Button>
    </View>
  );
}

type BudgetGroupsProps = {
  type: string;
  categoryGroups: CategoryGroupEntity[];
  onEditCategoryGroup: (id: CategoryGroupEntity['id']) => void;
  onEditCategory: (id: CategoryEntity['id']) => void;
  month: string;
  onBudgetAction: (month: string, action: string, args: unknown) => void;
  showHiddenCategories: boolean;
};

function BudgetGroups({
  categoryGroups,
  onEditCategoryGroup,
  onEditCategory,
  month,
  onBudgetAction,
  showHiddenCategories,
}: BudgetGroupsProps) {
  const { incomeGroup, expenseGroups } = useMemo(() => {
    const categoryGroupsToDisplay = categoryGroups.filter(
      group => !group.hidden || showHiddenCategories,
    );
    return {
      incomeGroup: categoryGroupsToDisplay.find(group => group.is_income),
      expenseGroups: categoryGroupsToDisplay.filter(group => !group.is_income),
    };
  }, [categoryGroups, showHiddenCategories]);

  const [collapsedGroupIds = [], setCollapsedGroupIdsPref] =
    useLocalPref('budget.collapsed');

  const onToggleCollapse = useCallback(
    (id: CategoryGroupEntity['id']) => {
      setCollapsedGroupIdsPref(
        collapsedGroupIds.includes(id)
          ? collapsedGroupIds.filter(collapsedId => collapsedId !== id)
          : [...collapsedGroupIds, id],
      );
    },
    [collapsedGroupIds, setCollapsedGroupIdsPref],
  );

  const isCollapsed = useCallback(
    (id: CategoryGroupEntity['id']) => {
      return collapsedGroupIds.includes(id);
    },
    [collapsedGroupIds],
  );

  return (
    <View
      data-testid="budget-groups"
      style={{ flex: '1 0 auto', paddingBottom: 15 }}
    >
      <ExpenseGroupList
        categoryGroups={expenseGroups}
        month={month}
        onEditCategoryGroup={onEditCategoryGroup}
        onEditCategory={onEditCategory}
        onBudgetAction={onBudgetAction}
        showHiddenCategories={showHiddenCategories}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
      />

      {incomeGroup && (
        <IncomeGroup
          categoryGroup={incomeGroup}
          month={month}
          showHiddenCategories={showHiddenCategories}
          onEditCategoryGroup={onEditCategoryGroup}
          onEditCategory={onEditCategory}
          onBudgetAction={onBudgetAction}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
        />
      )}
    </View>
  );
}

type BudgetTableProps = {
  categoryGroups: CategoryGroupEntity[];
  month: string;
  onShowBudgetSummary: () => void;
  onBudgetAction: (month: string, action: string, args: unknown) => void;
  onRefresh: () => Promise<void>;
  onEditCategoryGroup: (id: CategoryGroupEntity['id']) => void;
  onEditCategory: (id: CategoryEntity['id']) => void;
};

export function BudgetTable({
  categoryGroups,
  month,
  onShowBudgetSummary,
  onBudgetAction,
  onRefresh,
  onEditCategoryGroup,
  onEditCategory,
}: BudgetTableProps) {
  // let editMode = false; // neuter editMode -- sorry, not rewriting drag-n-drop right now

  const [showHiddenCategories = false] = useLocalPref(
    'budget.showHiddenCategories',
  );

  const [budgetType = 'envelope'] = useSyncedPref('budgetType');

  const schedulesQuery = useMemo(() => q('schedules').select('*'), []);
  const reservationMonths = useMemo(() => [month], [month]);

  const { headerRef, bodyRef } = useSyncedColumnScroll();

  return (
    // Mobile has no MonthsContext -- one month is on screen, so it is passed in.
    <ReservationsProvider months={reservationMonths}>
      <BudgetTableHeader
        ref={headerRef}
        month={month}
        onShowBudgetSummary={onShowBudgetSummary}
      />
      <PullToRefresh onRefresh={onRefresh}>
        <View
          data-testid="budget-table"
          style={{
            backgroundColor: theme.pageBackground,
            minHeight: '100vh',
            paddingBottom: MOBILE_NAV_HEIGHT,
          }}
        >
          <div
            ref={bodyRef}
            style={{ overflowX: 'auto', overflowY: 'hidden' }}
            data-testid="budget-table-scroller"
          >
            <View style={{ width: TABLE_WIDTH }}>
              <SchedulesProvider query={schedulesQuery}>
                <BudgetGroups
                  type={budgetType}
                  categoryGroups={categoryGroups}
                  showHiddenCategories={showHiddenCategories}
                  month={month}
                  onEditCategoryGroup={onEditCategoryGroup}
                  onEditCategory={onEditCategory}
                  onBudgetAction={onBudgetAction}
                />
              </SchedulesProvider>
            </View>
          </div>
        </View>
      </PullToRefresh>
    </ReservationsProvider>
  );
}

type BudgetTableHeaderProps = {
  ref: Ref<HTMLDivElement>;
  month: string;
  onShowBudgetSummary: () => void;
};

type HeaderColumnProps = {
  title: string;
  children?: ReactNode;
};

/** One value column heading, with its month total underneath when there is one. */
function HeaderColumn({ title, children }: HeaderColumnProps) {
  return (
    <View style={{ width: getColumnWidth() }}>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <AutoTextSize
          as={Label}
          minFontSizePx={6}
          maxFontSizePx={12}
          mode="oneline"
          title={title}
          style={{ color: theme.formInputText }}
        />
        {children}
      </View>
    </View>
  );
}

function BudgetTableHeader({
  ref,
  month,
  onShowBudgetSummary,
}: BudgetTableHeaderProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');

  const backgroundColor = monthUtils.isCurrentMonth(month)
    ? theme.budgetHeaderCurrentMonth
    : theme.budgetHeaderOtherMonth;

  const amountStyle: CSSProperties = {
    ...styles.tnum,
    color: theme.budgetNumberNeutral,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '500',
  };

  const total = (value: number, type: FormatType | undefined) => (
    <PrivacyFilter>
      <AutoTextSize
        key={value}
        as={Text}
        minFontSizePx={6}
        maxFontSizePx={12}
        mode="oneline"
        style={amountStyle}
      >
        {format(value, type)}
      </AutoTextSize>
    </PrivacyFilter>
  );

  return (
    <div
      ref={ref}
      data-testid="budget-table-header"
      // Scrolls with the rows below it; `useSyncedColumnScroll` keeps the two
      // in step. The bar is hidden because the rows already show one.
      style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        scrollbarWidth: 'none',
        backgroundColor,
        borderBottomWidth: 1,
        borderColor: theme.tableBorder,
      }}
    >
      <View
        style={{
          width: TABLE_WIDTH,
          // Matches the inset of the card the rows sit in, so every value
          // column lines up with its heading. Only on the left: a trailing
          // margin does not count towards the rows' scroll width, so adding
          // one here would leave the two scrollers 5px apart at the end.
          marginLeft: CARD_INSET,
          flexDirection: 'row',
          alignItems: 'center',
          padding: '10px 0',
        }}
      >
        <View
          style={{
            ...getFrozenColumnStyle(backgroundColor),
            flexDirection: 'row',
            justifyContent: 'flex-start',
            alignItems: 'center',
            paddingLeft: CARD_INSET,
          }}
        >
          {budgetType === 'tracking' ? (
            <Saved
              projected={month >= monthUtils.currentMonth()}
              onPress={onShowBudgetSummary}
            />
          ) : (
            <ToBudget
              toBudget={envelopeBudget.toBudget}
              onPress={onShowBudgetSummary}
            />
          )}
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'center',
            flex: 1,
          }}
        >
          <HeaderColumn title={t('Budgeted')}>
            <CellValue<'envelope-budget' | 'tracking-budget', 'total-budgeted'>
              binding={
                budgetType === 'tracking'
                  ? trackingBudget.totalBudgetedExpense
                  : envelopeBudget.totalBudgeted
              }
              type="financial"
            >
              {({ type, value }) =>
                total(budgetType === 'tracking' ? value : -value, type)
              }
            </CellValue>
          </HeaderColumn>

          <HeaderColumn title={t('Spent')}>
            <CellValue<'envelope-budget' | 'tracking-budget', 'total-spent'>
              binding={
                budgetType === 'tracking'
                  ? trackingBudget.totalSpent
                  : envelopeBudget.totalSpent
              }
              type="financial"
            >
              {({ type, value }) => total(value, type)}
            </CellValue>
          </HeaderColumn>

          <HeaderColumn title={t('Balance')}>
            <CellValue<'envelope-budget' | 'tracking-budget', 'total-leftover'>
              binding={
                budgetType === 'tracking'
                  ? trackingBudget.totalLeftover
                  : envelopeBudget.totalBalance
              }
              type="financial"
            >
              {({ type, value }) => total(value, type)}
            </CellValue>
          </HeaderColumn>
        </View>
      </View>
    </div>
  );
}
