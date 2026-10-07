import { aqlQuery } from '#server/aql';
import { getCurrency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import type { CategoryEntity } from '#types/models';
import type { ByTemplate } from '#types/models/templates';

import { getSheetValue } from './actions';
import { getTemplates, getTemplatesForCategory } from './goal-template';
import { getByReservationClaims, settleReservations } from './reservations';
import type { CategoryReservations } from './reservations';
import { getScheduleReservationClaims } from './schedule-template';

export type CategoryReservationsResult = CategoryReservations & {
  categoryId: CategoryEntity['id'];
  categoryName: string;
};

export async function getReservations({
  month,
  categoryId,
}: {
  month: string;
  categoryId?: CategoryEntity['id'];
}): Promise<CategoryReservationsResult[]> {
  const templates = categoryId
    ? await getTemplatesForCategory(categoryId)
    : await getTemplates();

  const { data: categories }: { data: CategoryEntity[] } = await aqlQuery(
    q('categories')
      .filter({ ...(categoryId ? { id: categoryId } : {}) })
      .select('*'),
  );

  const currencyPref = await aqlQuery(
    q('preferences').filter({ id: 'defaultCurrencyCode' }).select('*'),
  );
  const currency = getCurrency(
    currencyPref.data.length > 0 ? currencyPref.data[0].value : '',
  );

  const sheetName = monthUtils.sheetForMonth(month);
  const results: CategoryReservationsResult[] = [];

  for (const category of categories) {
    if (category.is_income || category.hidden) continue;

    const balance = await getSheetValue(sheetName, `leftover-${category.id}`);
    const categoryTemplates = templates[category.id] ?? [];

    const scheduleClaims = await getScheduleReservationClaims(
      categoryTemplates,
      month,
      category,
      currency,
    );
    const byClaims = getByReservationClaims(
      categoryTemplates.filter((t): t is ByTemplate => t.type === 'by'),
      month,
      category.name,
      currency.decimalPlaces,
    );

    results.push({
      categoryId: category.id,
      categoryName: category.name,
      ...settleReservations(balance, [...scheduleClaims, ...byClaims]),
    });
  }

  return results;
}
