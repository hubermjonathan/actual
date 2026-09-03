// @ts-strict-ignore
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import { getCurrency } from '#shared/currencies';
import { amountToInteger } from '#shared/util';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import type { CategoryEntity, CategoryGroupEntity } from '#types/models';
import type { CleanupTemplate } from '#types/models/cleanup-templates';
import type { Template } from '#types/models/templates';

import { getSheetValue, isTrackingBudget, setBudget, setGoal } from './actions';
import { CategoryTemplateContext } from './category-template-context';
import { tombstoneOrphanCleanupGroups } from './cleanup-groups';
import {
  settleReservations,
  type Allowance,
  type CategoryReservations,
} from './reservations';
import { getScheduleReservationClaims } from './schedule-template';
import { checkTemplateNotes, storeNoteTemplates } from './template-notes';
import type { TemplateNotification } from './template-notification';

export function distributeRemainder(
  templateContexts: CategoryTemplateContext[],
  availBudget: number,
): number {
  let remainderContexts = templateContexts.filter(c => c.hasRemainder());
  while (availBudget > 0 && remainderContexts.length > 0) {
    let remainderWeight = 0;
    remainderContexts.forEach(
      context => (remainderWeight += context.getRemainderWeight()),
    );
    const perWeight = availBudget / remainderWeight;
    const beforePass = availBudget;
    remainderContexts.forEach(context => {
      availBudget -= context.runRemainder(availBudget, perWeight);
    });
    if (availBudget === beforePass) break;
    remainderContexts = templateContexts.filter(c => c.hasRemainder());
  }
  return availBudget;
}

export async function storeTemplates({
  categoriesWithTemplates,
  source,
}: {
  categoriesWithTemplates: {
    id: string;
    templates: Template[];
    cleanup?: CleanupTemplate[];
  }[];
  source: 'notes' | 'ui';
}): Promise<void> {
  let touchedCleanup = false;
  await batchMessages(async () => {
    for (const { id, templates, cleanup } of categoriesWithTemplates) {
      const goalDefs = templates.length > 0 ? JSON.stringify(templates) : null;
      const update: Record<string, unknown> = {
        id,
        goal_def: goalDefs,
        template_settings: { source },
      };
      if (cleanup !== undefined) {
        update.cleanup_def =
          cleanup.length > 0 ? JSON.stringify(cleanup) : null;
        touchedCleanup = true;
      }
      await db.updateWithSchema('categories', update);
    }
  });
  if (touchedCleanup) {
    await tombstoneOrphanCleanupGroups();
  }
}

export async function applyTemplate({
  month,
}: {
  month: string;
}): Promise<TemplateNotification> {
  await storeNoteTemplates();
  const categoryTemplates = await getTemplates();
  const ret = await processTemplate(month, false, categoryTemplates, []);
  return ret;
}

export async function overwriteTemplate({
  month,
}: {
  month: string;
}): Promise<TemplateNotification> {
  await storeNoteTemplates();
  const categoryTemplates = await getTemplates();
  const ret = await processTemplate(month, true, categoryTemplates, []);
  return ret;
}

export async function applyMultipleCategoryTemplates({
  month,
  categoryIds,
}: {
  month: string;
  categoryIds: Array<CategoryEntity['id']>;
}) {
  const { data: categoryData }: { data: CategoryEntity[] } = await aqlQuery(
    q('categories')
      .filter({ id: { $oneof: categoryIds } })
      .select('*'),
  );
  await storeNoteTemplates();
  const categoryTemplates = await getTemplates(c => categoryIds.includes(c.id));
  const ret = await processTemplate(
    month,
    true,
    categoryTemplates,
    categoryData,
  );
  return ret;
}

export async function applySingleCategoryTemplate({
  month,
  category,
}: {
  month: string;
  category: CategoryEntity['id'];
}) {
  const { data: categoryData }: { data: CategoryEntity[] } = await aqlQuery(
    q('categories').filter({ id: category }).select('*'),
  );
  await storeNoteTemplates();
  const categoryTemplates = await getTemplates(c => c.id === category);
  const ret = await processTemplate(
    month,
    true,
    categoryTemplates,
    categoryData,
  );
  return ret;
}

export function runCheckTemplates() {
  return checkTemplateNotes();
}

async function getCategories(): Promise<CategoryEntity[]> {
  const { data: categoryGroups }: { data: CategoryGroupEntity[] } =
    await aqlQuery(q('category_groups').filter({ hidden: false }).select('*'));

  return categoryGroups.flatMap(g => g.categories || []).filter(c => !c.hidden);
}

async function getTemplates(
  filter: (category: CategoryEntity) => boolean = () => true,
): Promise<Record<CategoryEntity['id'], Template[]>> {
  //retrieves template definitions from the database
  const { data: categoriesWithGoalDef }: { data: CategoryEntity[] } =
    await aqlQuery(
      q('categories')
        .filter({ goal_def: { $ne: null } })
        .select('*'),
    );

  const categoryTemplates: Record<CategoryEntity['id'], Template[]> = {};
  for (const categoryWithGoalDef of categoriesWithGoalDef.filter(filter)) {
    if (!categoryWithGoalDef.goal_def) continue;
    categoryTemplates[categoryWithGoalDef.id] = JSON.parse(
      categoryWithGoalDef.goal_def,
    );
  }
  return categoryTemplates;
}

export async function getTemplatesForCategory(
  categoryId: CategoryEntity['id'],
): Promise<Record<CategoryEntity['id'], Template[]>> {
  return getTemplates(c => c.id === categoryId);
}

type TemplateBudget = {
  category: CategoryEntity['id'];
  budgeted: number;
};

async function setBudgets(month: string, templateBudget: TemplateBudget[]) {
  await batchMessages(async () => {
    templateBudget.forEach(element => {
      void setBudget({
        category: element.category,
        month,
        amount: element.budgeted,
      });
    });
  });
}

type TemplateGoal = {
  category: CategoryEntity['id'];
  goal: number | null;
  longGoal: number | null;
};

async function setGoals(month: string, templateGoal: TemplateGoal[]) {
  await batchMessages(async () => {
    templateGoal.forEach(element => {
      void setGoal({
        month,
        category: element.category,
        goal: element.goal,
        long_goal: element.longGoal,
      });
    });
  });
}

type ComputedTemplates = {
  contexts: CategoryTemplateContext[];
  errors: string[];
  orphanGoals: TemplateGoal[];
};

async function computeTemplates(
  month: string,
  force: boolean,
  categoryTemplates: Record<CategoryEntity['id'], Template[]>,
  categories: CategoryEntity[] = [],
  skipAvailableClamp: boolean = false,
): Promise<ComputedTemplates> {
  // setup categories
  const isTracking = isTrackingBudget();
  if (!categories.length) {
    categories = (await getCategories()).filter(
      c => isTracking || !c.is_income,
    );
  }

  // setup categories to process
  const templateContexts: CategoryTemplateContext[] = [];
  let availBudget = await getSheetValue(
    monthUtils.sheetForMonth(month),
    isTracking ? `total-saved` : `to-budget`,
  );
  const prioritiesSet = new Set<number>();
  const errors: string[] = [];
  const orphanGoals: TemplateGoal[] = [];
  for (const category of categories) {
    const { id } = category;
    const sheetName = monthUtils.sheetForMonth(month);
    const templates = categoryTemplates[id];
    const budgeted = await getSheetValue(sheetName, `budget-${id}`);
    const existingGoal = await getSheetValue(sheetName, `goal-${id}`);

    // only run categories that are unbudgeted or if we are forcing it
    if ((budgeted === 0 || force) && templates) {
      try {
        const templateContext = await CategoryTemplateContext.init(
          templates,
          category,
          month,
          budgeted,
          skipAvailableClamp,
        );
        // don't use the funds that are not from templates
        if (!templateContext.isGoalOnly()) {
          availBudget += budgeted;
        }
        availBudget += templateContext.getLimitExcess();
        templateContext.getPriorities().forEach(p => prioritiesSet.add(p));
        templateContexts.push(templateContext);
      } catch (e) {
        errors.push(`${category.name}: ${e.message}`);
      }

      // do a reset of the goals that are orphaned
    } else if (existingGoal !== null && !templates) {
      orphanGoals.push({
        category: id,
        goal: null,
        longGoal: null,
      });
    }
  }

  if (errors.length > 0) {
    return { contexts: templateContexts, errors, orphanGoals };
  }

  const priorities = new Int32Array([...prioritiesSet]).sort((a, b) => a - b);
  // run each priority level
  for (const priority of priorities) {
    const availStart = availBudget;
    for (const templateContext of templateContexts) {
      const budget = await templateContext.runTemplatesForPriority(
        priority,
        availBudget,
        availStart,
      );
      availBudget -= budget;
    }
  }

  distributeRemainder(templateContexts, availBudget);

  return { contexts: templateContexts, errors, orphanGoals };
}

async function processTemplate(
  month: string,
  force: boolean,
  categoryTemplates: Record<CategoryEntity['id'], Template[]>,
  categories: CategoryEntity[] = [],
): Promise<TemplateNotification> {
  const { contexts, errors, orphanGoals } = await computeTemplates(
    month,
    force,
    categoryTemplates,
    categories,
  );

  if (contexts.length === 0 && errors.length === 0) {
    if (orphanGoals.length > 0) {
      await setGoals(month, orphanGoals);
    }
    return {
      type: 'message',
      message: 'templates-up-to-date',
    };
  }
  if (errors.length > 0) {
    return {
      sticky: true,
      message: 'template-errors',
      pre: errors.join(`\n\n`),
    };
  }

  const budgetList: TemplateBudget[] = [];
  const goalList: TemplateGoal[] = [...orphanGoals];
  contexts.forEach(context => {
    const values = context.getValues();
    budgetList.push({
      category: context.category.id,
      budgeted: values.budgeted,
    });
    goalList.push({
      category: context.category.id,
      goal: values.goal,
      longGoal: values.longGoal ? 1 : null,
    });
  });
  await setBudgets(month, budgetList);
  await setGoals(month, goalList);

  return {
    type: 'message',
    message: 'templates-applied',
    count: contexts.length,
  };
}

export type DryRunCategoryResult = {
  budgeted: number;
  perTemplate: number[];
};

export type CategoryReservationsResult = CategoryReservations & {
  categoryId: CategoryEntity['id'];
  categoryName: string;
};

/**
 * Split each category's balance into what is reserved for known future costs
 * and what is genuinely available to spend.
 *
 * Read-only and derived on every call. Categories with no schedule templates
 * are reported with everything available, so a caller can render every row
 * from one result rather than special-casing.
 */
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

    const { claims } = categoryTemplates.length
      ? await getScheduleReservationClaims(
          categoryTemplates,
          month,
          category,
          currency,
        )
      : { claims: [] };

    // A fixed monthly amount is an allowance: spendable this month, but already
    // spoken for. It is not a reservation — reservations are money that must
    // NOT be spent yet because it belongs to a future cost.
    const allowances: Allowance[] = categoryTemplates.flatMap(t =>
      t.type === 'simple' && t.monthly
        ? [
            {
              label: t.label ?? category.name,
              amount: amountToInteger(t.monthly, currency.decimalPlaces),
            },
          ]
        : [],
    );

    results.push({
      categoryId: category.id,
      categoryName: category.name,
      ...settleReservations(balance, claims, allowances),
    });
  }

  return results;
}

export async function dryRunCategoryTemplate({
  month,
  categoryId,
  templates,
}: {
  month: string;
  categoryId: CategoryEntity['id'];
  templates: Template[];
}): Promise<DryRunCategoryResult> {
  // The projection answers "how much do these templates demand" — it
  // skips the priority clamp so future months (where To Budget is empty)
  // still show the templates' intended amount instead of 0.
  const { data: categoryData }: { data: CategoryEntity[] } = await aqlQuery(
    q('categories').filter({ id: categoryId }).select('*'),
  );
  if (categoryData.length === 0) {
    return { budgeted: 0, perTemplate: templates.map(() => 0) };
  }
  const { contexts } = await computeTemplates(
    month,
    true,
    { [categoryId]: templates },
    categoryData,
    true,
  );
  const ctx = contexts.find(c => c.category.id === categoryId);
  if (!ctx) return { budgeted: 0, perTemplate: templates.map(() => 0) };
  const values = ctx.getValues();
  return {
    budgeted: values.budgeted,
    perTemplate: templates.map(t => values.perTemplateContribution.get(t) ?? 0),
  };
}
