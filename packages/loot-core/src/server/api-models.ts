import type { Budget } from '#types/budget';
import type {
  AccountEntity,
  AccountGroupEntity,
  CategoryEntity,
  CategoryGroupEntity,
  NewRuleEntity,
  PayeeEntity,
  RuleEntity,
  ScheduleEntity,
  TagEntity,
} from '#types/models';

import type { CategoryReservationsResult } from './budget/goal-template';
import type { RemoteFile } from './cloud-storage';
import * as models from './models';

export type APIAccountEntity = Pick<AccountEntity, 'id' | 'name'> & {
  offbudget?: boolean;
  closed?: boolean;
  balance_current?: number | null;
  account_group_id?: string | null;
};

export const accountModel = {
  ...models.accountModel,

  toExternal(account: AccountEntity): APIAccountEntity {
    return {
      id: account.id,
      name: account.name,
      offbudget: account.offbudget ? true : false,
      closed: account.closed ? true : false,
      balance_current: account.balance_current ?? null,
      account_group_id: account.account_group_id ?? null,
    };
  },

  fromExternal(account: APIAccountEntity) {
    const result = { ...account } as unknown as AccountEntity;
    if ('offbudget' in account) {
      result.offbudget = account.offbudget ? 1 : 0;
    }
    if ('closed' in account) {
      result.closed = account.closed ? 1 : 0;
    }
    return result;
  },
};

export type APIAccountGroupEntity = Pick<AccountGroupEntity, 'id' | 'name'>;

export const accountGroupModel = {
  ...models.accountGroupModel,

  toExternal(group: AccountGroupEntity): APIAccountGroupEntity {
    return {
      id: group.id,
      name: group.name,
    };
  },

  fromExternal(group: Partial<APIAccountGroupEntity>) {
    // No translation is needed
    return group as Partial<AccountGroupEntity>;
  },
};

export type APICategoryEntity = Pick<
  CategoryEntity,
  'id' | 'name' | 'is_income' | 'hidden'
> & {
  group_id: string;
};

export const categoryModel = {
  ...models.categoryModel,

  toExternal(category: CategoryEntity): APICategoryEntity {
    return {
      id: category.id,
      name: category.name,
      is_income: category.is_income ? true : false,
      hidden: category.hidden ? true : false,
      group_id: category.group,
    };
  },

  fromExternal(category: APICategoryEntity) {
    const { group_id, ...apiCategory } = category;
    const result: CategoryEntity = {
      ...apiCategory,
      group: group_id,
    };
    return result;
  },
};

export type APICategoryGroupEntity = Pick<
  CategoryGroupEntity,
  'id' | 'name' | 'is_income' | 'hidden'
> & {
  categories?: APICategoryEntity[];
};

export const categoryGroupModel = {
  ...models.categoryGroupModel,

  toExternal(group: CategoryGroupEntity): APICategoryGroupEntity {
    return {
      id: group.id,
      name: group.name,
      is_income: group.is_income ? true : false,
      hidden: group.hidden ? true : false,
      categories:
        group.categories?.map(cat => categoryModel.toExternal(cat)) || [],
    };
  },

  fromExternal(group: APICategoryGroupEntity) {
    const result = { ...group } as unknown as CategoryGroupEntity;
    if ('categories' in group && group.categories) {
      result.categories = group.categories.map(cat =>
        categoryModel.fromExternal(cat),
      );
    }
    return result;
  },
};

export type APIPayeeEntity = Pick<PayeeEntity, 'id' | 'name' | 'transfer_acct'>;

export const payeeModel = {
  ...models.payeeModel,

  toExternal(payee: PayeeEntity) {
    return {
      id: payee.id,
      name: payee.name,
      transfer_acct: payee.transfer_acct,
    };
  },

  fromExternal(payee: APIPayeeEntity) {
    // No translation is needed
    return payee as PayeeEntity;
  },
};

export type APIRuleEntity = Omit<RuleEntity, 'stage'> & {
  stage: RuleEntity['stage'] | 'default';
};

function fromExternalRule(rule: APIRuleEntity): RuleEntity;
function fromExternalRule(rule: Omit<APIRuleEntity, 'id'>): NewRuleEntity;
function fromExternalRule(rule: Omit<APIRuleEntity, 'id'> | APIRuleEntity) {
  return {
    ...rule,
    stage: rule.stage === 'default' ? null : rule.stage,
  };
}

export const ruleModel = {
  fromExternal: fromExternalRule,
};

export type APITagEntity = Pick<
  TagEntity,
  'id' | 'tag' | 'color' | 'description'
>;

export const tagModel = {
  toExternal(tag: TagEntity): APITagEntity {
    return {
      id: tag.id,
      tag: tag.tag,
      color: tag.color ?? null,
      description: tag.description ?? null,
    };
  },

  fromExternal(tag: Partial<APITagEntity>): Partial<TagEntity> {
    return tag;
  },
};

export type APIFileEntity = Omit<RemoteFile, 'deleted' | 'fileId'> & {
  id?: string;
  cloudFileId: string;
  state?: 'remote';
};

export const remoteFileModel = {
  toExternal(file: RemoteFile): APIFileEntity | null {
    if (file.deleted) {
      return null;
    }
    return {
      cloudFileId: file.fileId,
      state: 'remote',
      groupId: file.groupId,
      name: file.name,
      encryptKeyId: file.encryptKeyId,
      hasKey: file.hasKey,
      owner: file.owner,
      usersWithAccess: file.usersWithAccess,
    };
  },

  fromExternal(file: APIFileEntity) {
    return { deleted: false, fileId: file.cloudFileId, ...file } as RemoteFile;
  },
};

export const budgetModel = {
  toExternal(file: Budget): APIFileEntity {
    return file as APIFileEntity;
  },

  fromExternal(file: APIFileEntity) {
    return file as Budget;
  },
};

export type AmountOPType = 'is' | 'isapprox' | 'isbetween';

export type APIScheduleEntity = Pick<
  ScheduleEntity,
  'id' | 'name' | 'posts_transaction'
> & {
  rule?: ScheduleEntity['rule']; //All schedules has an associated underlying rule. not to be supplied iwth a new schedule
  next_date?: ScheduleEntity['next_date']; //Next occurence of a schedule. not to be supplied iwth a new schedule
  completed?: ScheduleEntity['completed']; //not to be supplied with a new schedule
  payee?: ScheduleEntity['_payee']; // Optional will default to null
  account?: ScheduleEntity['_account']; // Optional will default to null
  amount?: ScheduleEntity['_amount']; // Provide only 1 number except if the Amount
  amountOp: AmountOPType; // 'is' | 'isapprox' | 'isbetween'
  date: ScheduleEntity['_date']; // mandatory field in creating a schedule Mandatory field in creation
};

export const scheduleModel = {
  toExternal(schedule: ScheduleEntity): APIScheduleEntity {
    return {
      id: schedule.id,
      name: schedule.name,
      rule: schedule.rule,
      next_date: schedule.next_date,
      completed: schedule.completed,
      posts_transaction: schedule.posts_transaction,
      payee: schedule._payee,
      account: schedule._account,
      amount: schedule._amount,
      amountOp: schedule._amountOp as 'is' | 'isapprox' | 'isbetween', // e.g. 'isapprox', 'is', etc.
      date: schedule._date,
    };
  },
  //just an update

  fromExternal(schedule: APIScheduleEntity): ScheduleEntity {
    const amount = schedule.amount ?? 0;
    const result: ScheduleEntity = {
      id: schedule.id,
      name: schedule.name,
      rule: String(schedule.rule),
      next_date: String(schedule.next_date),
      completed: Boolean(schedule.completed),
      posts_transaction: schedule.posts_transaction,
      tombstone: false,
      _payee: String(schedule.payee),
      _account: String(schedule.account),
      _amount: amount,
      _amountOp: schedule.amountOp, // e.g. 'isapprox', 'is', etc.
      _date: schedule.date,
      _conditions: [
        { op: 'is', field: 'payee', value: String(schedule.payee) },
        { op: 'is', field: 'account', value: String(schedule.account) },
        { op: 'isapprox', field: 'date', value: schedule.date },
        { op: schedule.amountOp, field: 'amount', value: amount },
      ],
      _actions: [], // empty array, as you requested
    };

    return result;
  },
};

/**
 * One claim on a category balance. This is a bill the category saves towards.
 *
 * All amounts are integer cents, like everywhere else in the API. `accrued` is
 * a fraction of the target and is rounded, so per-claim figures can differ from
 * the category total by a cent; the category's own fields are authoritative.
 */
export type APIReservationClaimEntity = {
  /** The schedule this claim tracks. */
  name: string;
  /** Full amount of the future cost. */
  target: number;
  /** Next occurrence, `YYYY-MM-DD`. Claims are settled in this order. */
  nextDate: string;
  /** What this claim accrues each month. */
  monthlyRate: number;
  /** Whole months until the cost lands. 0 means it is due this month. */
  monthsRemaining: number;
  /** What should already be set aside for it by now. */
  accrued: number;
  /** What the balance actually covers. Never more than `accrued`. */
  reserved: number;
  /** `accrued - reserved`. Above zero means this claim is behind. */
  shortfall: number;
  onTrack: boolean;
  /** Written `[fixed]`: accrues at a flat rate rather than sharing the pot. */
  fixed: boolean;
};

/** One allowance in a category, e.g. `#template 1000 [groceries]`. */
export type APIAllowanceEntity = {
  label: string;
  amount: number;
};

/**
 * How one category's balance divides up in a given month.
 *
 * Derived on every call and never stored, so the figures follow the balance
 * without anything to invalidate.
 */
export type APICategoryReservationsEntity = {
  categoryId: CategoryEntity['id'];
  categoryName: string;
  balance: number;
  /** Owed to a future cost. Should not be spent yet. */
  reserved: number;
  /** The allowance left for this month. You can spend it. That is its purpose. */
  allowance: number;
  /** `reserved + allowance`. The part of the balance that has a job. */
  committed: number;
  /** `balance - committed`. Genuinely nothing claiming it. */
  spare: number;
  /** What should be set aside across every claim, held or not. */
  accrued: number;
  /** `accrued - reserved`. The total amount the category is behind by. */
  shortfall: number;
  /** Every claim's full future cost. */
  target: number;
  /** `null` when the category has nothing to measure against. */
  status: 'behind' | 'onPace' | 'ahead' | 'funded' | null;
  claims: APIReservationClaimEntity[];
  allowances: APIAllowanceEntity[];
};

export const reservationsModel = {
  toExternal(
    reservations: CategoryReservationsResult,
  ): APICategoryReservationsEntity {
    return {
      categoryId: reservations.categoryId,
      categoryName: reservations.categoryName,
      balance: reservations.balance,
      reserved: reservations.reserved,
      allowance: reservations.allowance,
      // Summed here rather than in the core so the API publishes the same
      // umbrella figure the budget's Committed column shows, without callers
      // having to know it is a sum.
      committed: reservations.reserved + reservations.allowance,
      spare: reservations.spare,
      accrued: reservations.accrued,
      shortfall: reservations.shortfall,
      target: reservations.target,
      status: reservations.status,
      claims: reservations.claims.map(claim => ({
        name: claim.name,
        target: claim.target,
        nextDate: claim.nextDate,
        monthlyRate: claim.monthlyRate,
        monthsRemaining: claim.monthsRemaining,
        accrued: claim.accrued,
        reserved: claim.reserved,
        shortfall: claim.shortfall,
        onTrack: claim.onTrack,
        fixed: !!claim.fixed,
      })),
      allowances: reservations.allowances.map(allowance => ({
        label: allowance.label,
        amount: allowance.amount,
      })),
    };
  },
};
