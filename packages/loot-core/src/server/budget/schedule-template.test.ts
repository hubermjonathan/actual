import * as db from '#server/db';
import { Rule } from '#server/rules';
import { getRuleForSchedule } from '#server/schedules/app';
import type { Currency } from '#shared/currencies';
import type { CategoryEntity } from '#types/models';
import type { ScheduleTemplate } from '#types/models/templates';

import { getSheetValue, isTrackingBudget } from './actions';
import { getScheduleReservationClaims, runSchedule } from './schedule-template';

vi.mock('#server/db');
vi.mock('./actions');
vi.mock('#server/schedules/app', async () => {
  const actualModule = await vi.importActual('#server/schedules/app');
  return {
    ...actualModule,
    getRuleForSchedule: vi.fn(),
  };
});

const defaultCurrency: Currency = {
  code: '',
  symbol: '',
  name: '',
  decimalPlaces: 2,
  numberFormat: 'comma-dot',
  symbolFirst: false,
};

const defaultCategory = { id: '1', name: 'Test Category' } as CategoryEntity;

type RuleSpec = {
  id?: string;
  start: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'weekly' | 'daily';
  interval?: number;
};

function makeRule({
  id = 'r',
  start,
  amount,
  frequency,
  interval = 1,
}: RuleSpec): Rule {
  return new Rule({
    id,
    stage: 'pre',
    conditionsOp: 'and',
    conditions: [
      {
        op: 'is',
        field: 'date',
        value: {
          start,
          interval,
          frequency,
          patterns: [],
          skipWeekend: false,
          weekendSolveMode: 'before',
          endMode: 'never',
          endOccurrences: 1,
          endDate: '2099-01-01',
        },
        type: 'date',
      },
      { op: 'is', field: 'amount', value: amount, type: 'number' },
    ],
    actions: [],
  });
}

function mockSingleSchedule(spec: RuleSpec, completed: number = 0) {
  vi.mocked(db.first).mockResolvedValue({ id: 1, completed });
  vi.mocked(getRuleForSchedule).mockResolvedValue(makeRule(spec));
  vi.mocked(isTrackingBudget).mockReturnValue(false);
}

function mockSchedulesByName(
  specsByName: Record<string, { spec: RuleSpec; completed?: number }>,
) {
  const names = Object.keys(specsByName);
  const sidByName: Record<string, number> = Object.fromEntries(
    names.map((name, i) => [name, i + 1]),
  );
  vi.mocked(db.first).mockImplementation(
    async (_q: string, params?: unknown[]) => {
      const name = (params as string[] | undefined)?.[0] ?? '';
      return {
        id: sidByName[name],
        completed: specsByName[name]?.completed ?? 0,
      };
    },
  );
  vi.mocked(getRuleForSchedule).mockImplementation(async id => {
    const name = names.find(n => sidByName[n] === Number(id)) ?? names[0];
    return makeRule(specsByName[name].spec);
  });
  vi.mocked(isTrackingBudget).mockReturnValue(false);
}

describe('runSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAccounts).mockResolvedValue([]);
  });

  it('should return correct budget when recurring schedule set', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Test Schedule',
        priority: 0,
        directive: 'template',
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-08-01',
      amount: -10000,
      frequency: 'monthly',
    });

    const result = await runSchedule(
      template_lines,
      '2024-08-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(result.to_budget).toBe(10000);
    expect(result.errors).toHaveLength(0);
    expect(result.remainder).toBe(0);
  });

  it('should return correct budget when yearly recurring schedule set and balance is greater than target', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Test Schedule',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-08-01',
      amount: -12000,
      frequency: 'yearly',
    });

    const result = await runSchedule(
      template_lines,
      '2024-09-01',
      12000,
      0,
      12000,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(result.to_budget).toBe(1000);
    expect(result.errors).toHaveLength(0);
    expect(result.remainder).toBe(0);
  });

  it('returns a per-template monthly attribution map keyed by template', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: '  Test Schedule  ',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-08-01',
      amount: -10000,
      frequency: 'monthly',
    });

    const result = await runSchedule(
      template_lines,
      '2024-08-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(result.perScheduleMonthly.get(template_lines[0])).toBe(10000);
    expect(result.to_budget).toBe(10000);
  });

  it('handles a pay-month-of monthly schedule alongside a yearly sinking schedule', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Internet',
        directive: 'template',
        priority: 0,
      } as const,
      {
        type: 'schedule',
        name: 'Insurance',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSchedulesByName({
      Internet: {
        spec: { start: '2024-01-15', amount: -10000, frequency: 'monthly' },
      },
      Insurance: {
        spec: { start: '2024-12-15', amount: -60000, frequency: 'yearly' },
      },
    });

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(result.errors).toHaveLength(0);
    const internet = result.perScheduleMonthly.get(template_lines[0]) ?? 0;
    const insurance = result.perScheduleMonthly.get(template_lines[1]) ?? 0;
    expect(internet).toBe(10000); // pay-month-of: full target
    expect(insurance).toBeGreaterThan(0);
    expect(insurance).toBeLessThan(internet);
    expect(internet + insurance).toBeCloseTo(result.to_budget, -1);
  });

  it('budgets nothing in advance for a yearly schedule with `full: true`', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Insurance',
        full: true,
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-12-15',
      amount: -60000,
      frequency: 'yearly',
    });

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(0);
    expect(result.perScheduleMonthly.get(template_lines[0])).toBeUndefined();
  });

  it('only attributes contribution to schedules occurring this month when full: true is used', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Schedule A',
        full: true,
        directive: 'template',
        priority: 0,
      } as const,
      {
        type: 'schedule',
        name: 'Schedule B',
        full: true,
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSchedulesByName({
      'Schedule A': {
        spec: { start: '2024-08-01', amount: -10000, frequency: 'monthly' },
      },
      'Schedule B': {
        spec: { start: '2024-09-01', amount: -20000, frequency: 'monthly' },
      },
    });

    const result = await runSchedule(
      template_lines,
      '2024-08-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(result.to_budget).toBe(10000);
    expect(result.perScheduleMonthly.get(template_lines[0])).toBe(10000);
    expect(result.perScheduleMonthly.get(template_lines[1])).toBeUndefined();
  });

  it('applies a percent adjustment to the schedule amount', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Bill',
        adjustment: 10,
        adjustmentType: 'percent',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-08-15',
      amount: -10000,
      frequency: 'monthly',
    });

    const result = await runSchedule(
      template_lines,
      '2024-08-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(11000); // $100 × 1.10
  });

  it('applies a fixed adjustment to the schedule amount', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Bill',
        adjustment: 5,
        adjustmentType: 'fixed',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-08-15',
      amount: -10000,
      frequency: 'monthly',
    });

    const result = await runSchedule(
      template_lines,
      '2024-08-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(10500); // $100 + $5
  });

  it('skips completed schedules from the budget total', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Done',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule(
      { start: '2024-08-15', amount: -10000, frequency: 'monthly' },
      1,
    );

    const result = await runSchedule(
      template_lines,
      '2024-08-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(0);
  });

  it('budgets all daily occurrences within the month for a daily schedule', async () => {
    const template_lines = [
      {
        type: 'schedule',
        name: 'Daily Bill',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-01-01',
      amount: -100,
      frequency: 'daily',
    });

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(3100); // 31 days × $1
  });

  it('sorts sinking schedules by next due date so existing balance covers the earliest first', async () => {
    // Templates given in reverse-date order to verify the engine sorts.
    // Sorted (May first): ($1200-$200)/5 + $600/11 = $254.55 → 25455
    // Unsorted (Nov first): ($600-$200)/11 + $1200/5 = $276.36 — the
    // assertion below only matches if the sort runs.
    const template_lines = [
      {
        type: 'schedule',
        name: 'November bill',
        directive: 'template',
        priority: 0,
      } as const,
      {
        type: 'schedule',
        name: 'May bill',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSchedulesByName({
      'November bill': {
        spec: { start: '2024-11-15', amount: -60000, frequency: 'yearly' },
      },
      'May bill': {
        spec: { start: '2024-05-15', amount: -120000, frequency: 'yearly' },
      },
    });

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      0,
      0,
      20000,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(result.errors).toHaveLength(0);
    expect(result.to_budget).toBe(25455);
  });

  it('records a Past error for a non-repeating schedule whose date has already passed', async () => {
    // Non-repeating (no frequency) and dated before current_month → engine
    // marks it as past rather than rolling forward.
    const template_lines = [
      {
        type: 'schedule',
        name: 'Past',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    vi.mocked(db.first).mockResolvedValue({ id: 1, completed: 0 });
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      new Rule({
        id: 'r',
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [
          { op: 'is', field: 'date', value: '2023-06-01', type: 'date' },
          { op: 'is', field: 'amount', value: -10000, type: 'number' },
        ],
        actions: [],
      }),
    );
    vi.mocked(isTrackingBudget).mockReturnValue(false);

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.errors).toContainEqual(
      expect.stringMatching(/Schedule Past is in the Past/),
    );
    expect(result.to_budget).toBe(0);
  });

  it('contributes target/interval per month for a fully-funded bi-monthly schedule', async () => {
    // Every-2-months from 2024-03-15: interval 2 keeps it out of the
    // pay-month-of fast path. With balance == target the engine takes
    // the base-contribution branch: target / interval = $200 / 2 = $100.
    const template_lines = [
      {
        type: 'schedule',
        name: 'BiMonthly',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-03-15',
      amount: -20000,
      frequency: 'monthly',
      interval: 2,
    });

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      20000,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(10000);
  });

  it('contributes target / months-spanned for a fully-funded six-week schedule', async () => {
    // Every 6 weeks from 2024-02-12: outside the weekly pay-month-of
    // cap (≤4), so it sinks. With balance == target the base path runs:
    // prev = subWeeks(2024-02-12, 6) = 2024-01-01, span = 1 month →
    // contribution = $60 / 1 = $60.
    const template_lines = [
      {
        type: 'schedule',
        name: 'EverySixWeeks',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-02-12',
      amount: -6000,
      frequency: 'weekly',
      interval: 6,
    });

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      6000,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(6000);
  });

  it('contributes target / months-spanned for a fully-funded sixty-day schedule', async () => {
    // Every 60 days from 2024-03-01: outside the daily pay-month-of
    // cap (≤31), so it sinks. With balance == target the base path
    // runs: prev = subDays(2024-03-01, 60) = 2024-01-01, span = 2
    // months → contribution = $60 / 2 = $30.
    const template_lines = [
      {
        type: 'schedule',
        name: 'EverySixtyDays',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-03-01',
      amount: -6000,
      frequency: 'daily',
      interval: 60,
    });

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      6000,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(3000);
  });

  it('keeps meeting the deadline for a schedule repeating every 360 days', async () => {
    // Every 360 days is daily in shape but yearly in effect, so it sinks:
    // $500 due 2026-05-15 spread over the five months from January is $100
    // a month. Once January is funded, February used to drop to $41.67 --
    // subDays(2026-05-15, 360) lands in May 2025, and that 12-month span
    // became the divisor. The deadline and the $100 already saved were both
    // ignored, so the category came up short in May.
    const template_lines = [
      {
        type: 'schedule',
        name: 'EveryThreeSixtyDays',
        directive: 'template',
        priority: 0,
      } satisfies ScheduleTemplate,
    ];
    mockSingleSchedule({
      start: '2026-05-15',
      amount: -50000,
      frequency: 'daily',
      interval: 360,
    });
    // January budgeted $100 and nothing was spent, so it carries forward and
    // is also last month's goal.
    vi.mocked(getSheetValue).mockResolvedValue(10000);

    const result = await runSchedule(
      template_lines,
      '2026-02-01',
      10000,
      0,
      10000,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(10000);
  });

  it('absorbs surplus when last-month balance exceeds a sinking schedule target', async () => {
    // Last-month balance ($150) > yearly target ($120). The sink rolls
    // the surplus forward and contributes nothing this month.
    const template_lines = [
      {
        type: 'schedule',
        name: 'Overfunded',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    mockSingleSchedule({
      start: '2024-12-15',
      amount: -12000,
      frequency: 'yearly',
    });

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      0,
      0,
      15000,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(0);
  });

  it('forces sinking schedules into pay-month-of mode when tracking-budget is on', async () => {
    // In tracking mode every schedule is treated as pay-month-of. A
    // far-future yearly schedule that would normally contribute ~$100/mo
    // sinking instead contributes 0 this month, since pay-month-of only
    // counts schedules whose num_months is 0.
    const template_lines = [
      {
        type: 'schedule',
        name: 'YearlyFar',
        directive: 'template',
        priority: 0,
      } as const,
    ];
    vi.mocked(db.first).mockResolvedValue({ id: 1, completed: 0 });
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      makeRule({ start: '2024-12-15', amount: -12000, frequency: 'yearly' }),
    );
    vi.mocked(isTrackingBudget).mockReturnValue(true);

    const result = await runSchedule(
      template_lines,
      '2024-01-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );
    expect(result.to_budget).toBe(0);
  });

  // The point of [fixed] is that the balance does not change the amount, so the
  // same assertion must hold for an empty and an already-funded category.
  it.each([0, 120000])(
    'contributes the same amount each month when marked fixed (balance %i)',
    async last_month_balance => {
      // 1,200.00 a year is 100.00 a month regardless of what has been saved.
      const template_lines = [
        {
          type: 'schedule',
          name: 'Test Schedule',
          fixed: true,
          priority: 0,
          directive: 'template',
        } as const,
      ];
      mockSingleSchedule({
        start: '2024-08-01',
        amount: -120000,
        frequency: 'yearly',
      });

      const result = await runSchedule(
        template_lines,
        '2024-09-01',
        0,
        0,
        last_month_balance,
        0,
        [],
        defaultCategory,
        defaultCurrency,
      );

      expect(result.to_budget).toBe(10000);
    },
  );

  it('differs from the pooled behaviour when partly saved', async () => {
    // 1,200.00 due in 11 months with 600.00 already saved.
    //   pooled: spreads the remaining 600.00 over 12 months -> 50.00
    //   fixed:  keeps to 1,200.00 / 12                      -> 100.00
    const schedule = {
      start: '2024-08-01',
      amount: -120000,
      frequency: 'yearly' as const,
    };
    const runWith = (lines: Parameters<typeof runSchedule>[0]) =>
      runSchedule(
        lines,
        '2024-09-01',
        60000,
        0,
        60000,
        0,
        [],
        defaultCategory,
        defaultCurrency,
      );

    mockSingleSchedule(schedule);
    const pooled = await runWith([
      {
        type: 'schedule',
        name: 'Test Schedule',
        priority: 0,
        directive: 'template',
      },
    ]);

    mockSingleSchedule(schedule);
    const fixed = await runWith([
      {
        type: 'schedule',
        name: 'Test Schedule',
        fixed: true,
        priority: 0,
        directive: 'template',
      },
    ]);

    expect(pooled.to_budget).toBe(5000);
    expect(fixed.to_budget).toBe(10000);
  });
});

describe('a category whose only sinking claims are [fixed]', () => {
  // Wants (Reserved), October 2026: two monthly bills due this month, and the
  // yearly ones all [fixed]. The balance held exactly what the fixed claims
  // had saved by the end of September, so the month needs the two bills and
  // one month of each fixed claim - 305.48. It asked for 389.1166..., which
  // also could not be saved.
  const lines = [
    {
      type: 'schedule',
      name: 'Bill',
      priority: 0,
      directive: 'template',
    } as const,
    {
      type: 'schedule',
      name: 'Pass',
      fixed: true,
      priority: 0,
      directive: 'template',
    } as const,
  ];
  // 1,000.00 a year due in March: 83.33... a month, 416.67 held by the end of
  // August (5 of 12 months saved, 7 to go).
  const specs = {
    Bill: {
      spec: {
        start: '2024-08-15',
        amount: -50000,
        frequency: 'monthly' as const,
      },
    },
    Pass: {
      spec: {
        start: '2024-03-01',
        amount: -100000,
        frequency: 'yearly' as const,
      },
    },
  };

  it('budgets the bills and one month of the fixed claim, in whole cents', async () => {
    mockSchedulesByName(specs);
    const held = 41667;

    const result = await runSchedule(
      lines,
      '2024-09-01',
      held,
      0,
      held,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(Number.isInteger(result.to_budget)).toBe(true);
    expect(result.to_budget).toBe(50000 + 8333);
  });

  it('catches up a fixed claim the balance does not cover', async () => {
    mockSchedulesByName(specs);

    // 100.00 short of what Pass should hold.
    const result = await runSchedule(
      lines,
      '2024-09-01',
      31667,
      0,
      31667,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(result.to_budget).toBe(50000 + 8333 + 10000);
  });
});

describe('getScheduleReservationClaims', () => {
  const template_lines = [
    {
      type: 'schedule',
      name: 'Test Schedule',
      priority: 0,
      directive: 'template',
    } as const,
  ];

  // db.first serves three queries here: the schedule row that
  // createScheduleList reads, the stored next date, and the transactions
  // linked to the schedule. `linkedDate` is the date of one linked
  // transaction, or null for none.
  function mockSchedule(
    storedNextDate: number | null,
    linkedDate: number | null = null,
  ) {
    vi.mocked(db.first).mockImplementation(
      async (query: string, params?: unknown[]) => {
        if (query.includes('schedules_next_date')) {
          return storedNextDate == null
            ? undefined
            : { next_date: storedNextDate };
        }
        if (query.includes('v_transactions')) {
          const [, from, to] = params as number[];
          return linkedDate != null && linkedDate >= from && linkedDate <= to
            ? { id: 'tx-1' }
            : undefined;
        }
        return { id: 1, completed: 0 };
      },
    );
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      makeRule({ start: '2024-08-01', amount: -10000, frequency: 'monthly' }),
    );
    vi.mocked(isTrackingBudget).mockReturnValue(false);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAccounts).mockResolvedValue([]);
  });

  it('prefers the stored next date over the budget month occurrence', async () => {
    // The bill for August is paid, so the schedule has rolled to September.
    // createScheduleList still reports August, because August had to fund it.
    mockSchedule(20240901);

    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-08-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims).toHaveLength(1);
    expect(claims[0].nextDate).toBe('2024-09-01');
    expect(claims[0].monthsRemaining).toBe(1);
    // August's occurrence has been paid, which is why the stored date moved.
    expect(claims[0].settledThisMonth).toBe(true);
  });

  it('does not call a claim settled when the stored date has not moved', async () => {
    // The bill is due this month and has not been paid, so the stored date
    // still points at the same occurrence createScheduleList found.
    mockSchedule(20240801);

    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-08-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims[0].nextDate).toBe('2024-08-01');
    expect(claims[0].settledThisMonth).toBe(false);
  });

  it('does not call a claim settled when its occurrence is in a later month', async () => {
    // The schedule does not start until October, so August has no occurrence
    // and nothing in August can have been paid.
    mockSchedule(20241001);
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      makeRule({ start: '2024-10-01', amount: -10000, frequency: 'monthly' }),
    );

    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-08-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims[0].nextDate).toBe('2024-10-01');
    expect(claims[0].settledThisMonth).toBe(false);
  });

  it('falls back to the budget month occurrence when no date is stored', async () => {
    mockSchedule(null);

    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-08-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims).toHaveLength(1);
    expect(claims[0].nextDate).toBe('2024-08-01');
    expect(claims[0].monthsRemaining).toBe(0);
    expect(claims[0].settledThisMonth).toBe(false);
  });

  it('keeps cycling on the calendar when the stored date froze in the past', async () => {
    // The regression this exists for: Bentley Insurance was charged on 9/25,
    // nothing linked, and its stored date sat at 9/25 for good. The claim then
    // reserved the whole bill in every later month. The calendar says the
    // November bill is due 11/25, so November reserves November's bill and
    // nothing more.
    mockSchedule(20240925);
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      makeRule({ start: '2024-09-25', amount: -4255, frequency: 'monthly' }),
    );

    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-11-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims[0].nextDate).toBe('2024-11-25');
    expect(claims[0].monthsRemaining).toBe(0);
    expect(claims[0].settledThisMonth).toBe(false);
  });

  it('reads as spent when a linked payment is in the month, whatever the rule start says', async () => {
    // The `(spent)` defect: advancing a schedule rewrites its rule's start, so
    // the rule alone has no August occurrence any more. Rent paid on 8/1 then
    // read 0.00 instead of spent.
    mockSchedule(20240801, 20240801);
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      makeRule({ start: '2024-09-01', amount: -10000, frequency: 'monthly' }),
    );

    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-08-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims[0].settledThisMonth).toBe(true);
    expect(claims[0].nextDate).toBe('2024-09-01');
  });

  it('reads as spent when the schedule advanced with no link in the month', async () => {
    // Paid on the last day of the previous month: the link is dated July, but
    // the schedule moved past August's occurrence.
    mockSchedule(20240901, 20240731);

    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-08-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims[0].settledThisMonth).toBe(true);
  });

  it("does not let last month's late payment mark this month's bill paid", async () => {
    // Internet's bill for 9/30 posted and linked on 10/02. October's own bill
    // is due 10/31 and is not paid.
    mockSchedule(20241030, 20241002);
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      makeRule({ start: '2024-09-30', amount: -4000, frequency: 'monthly' }),
    );

    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-10-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims[0].nextDate).toBe('2024-10-30');
    expect(claims[0].settledThisMonth).toBe(false);
  });

  it('reports the fixed flag from the template', async () => {
    mockSchedule(null);

    const claims = await getScheduleReservationClaims(
      [{ ...template_lines[0], fixed: true }],
      '2024-08-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims[0].fixed).toBe(true);
  });
});

describe('a template that names a deleted schedule', () => {
  // Deleting a schedule leaves its template line in the note.
  const template_lines = [
    {
      type: 'schedule',
      name: 'Ghost Schedule',
      priority: 0,
      directive: 'template',
    } as const,
    {
      type: 'schedule',
      name: 'Test Schedule',
      priority: 0,
      directive: 'template',
    } as const,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAccounts).mockResolvedValue([]);
    vi.mocked(db.first).mockImplementation(
      async (query: string, params?: unknown[]) => {
        if (query.includes('schedules_next_date')) return undefined;
        const name = (params as string[] | undefined)?.[0];
        return name === 'Test Schedule' ? { id: 1, completed: 0 } : null;
      },
    );
    vi.mocked(getRuleForSchedule).mockResolvedValue(
      makeRule({ start: '2024-08-01', amount: -10000, frequency: 'monthly' }),
    );
    vi.mocked(isTrackingBudget).mockReturnValue(false);
  });

  it('reports the missing schedule and budgets the rest', async () => {
    const result = await runSchedule(
      template_lines,
      '2024-08-01',
      0,
      0,
      0,
      0,
      [],
      defaultCategory,
      defaultCurrency,
    );

    expect(result.errors).toEqual(['Schedule Ghost Schedule does not exist.']);
    expect(result.to_budget).toBe(10000);
  });

  it('claims for the schedules that are left', async () => {
    const claims = await getScheduleReservationClaims(
      template_lines,
      '2024-08-01',
      defaultCategory,
      defaultCurrency,
    );

    expect(claims.map(c => c.name)).toEqual(['Test Schedule']);
  });
});
