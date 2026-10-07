import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { fromDateRepr } from '#server/models';
import { Rule } from '#server/rules';
import { getRuleForSchedule } from '#server/schedules/app';
import type { Currency } from '#shared/currencies';
import type { CategoryEntity } from '#types/models';
import type { ScheduleTemplate } from '#types/models/templates';

import { getSheetValue, isTrackingBudget } from './actions';
import { getScheduleReservationClaims, runSchedule } from './schedule-template';

vi.mock('#server/aql');
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

  it.each([0, 60000, 120000])(
    'contributes the same amount each month when marked fixed (balance %i)',
    async last_month_balance => {
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
});

describe('a category whose only sinking claims are [fixed]', () => {
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
  // Pass: 1,000.00 a year due in March, 83.33... a month, 416.67 held by the
  // end of August.
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

  it.each([
    ['budgets the bills and one month of the fixed claim', 41667, 50000 + 8333],
    [
      'catches up a fixed claim the balance does not cover',
      31667,
      50000 + 8333 + 10000,
    ],
  ])('%s, in whole cents', async (_, held, expected) => {
    mockSchedulesByName(specs);

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

    expect(result.to_budget).toBe(expected);
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

  // `linkedDate` is the date of one transaction linked to the schedule.
  function mockSchedule(
    storedNextDate: number | null,
    linkedDate: number | null = null,
    ruleStart = '2024-08-01',
  ) {
    vi.mocked(aqlQuery).mockResolvedValue({
      data:
        storedNextDate == null
          ? []
          : [{ next_date: fromDateRepr(storedNextDate) }],
      dependencies: [],
    });
    vi.mocked(db.first).mockImplementation(
      async (query: string, params?: unknown[]) => {
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
      makeRule({ start: ruleStart, amount: -10000, frequency: 'monthly' }),
    );
    vi.mocked(isTrackingBudget).mockReturnValue(false);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAccounts).mockResolvedValue([]);
  });

  it.each([
    // The schedule rolled to September, so August's bill is paid.
    [
      'advanced past',
      20240901,
      null,
      '2024-08-01',
      '2024-08-01',
      '2024-09-01',
      1,
      true,
    ],
    // Advancing a schedule rewrites its rule's start.
    [
      'linked, rule start moved on',
      20240801,
      20240801,
      '2024-09-01',
      '2024-08-01',
      '2024-09-01',
      1,
      true,
    ],
    [
      'due and unpaid',
      20240801,
      null,
      '2024-08-01',
      '2024-08-01',
      '2024-08-01',
      0,
      false,
    ],
    [
      'no stored date',
      null,
      null,
      '2024-08-01',
      '2024-08-01',
      '2024-08-01',
      0,
      false,
    ],
    [
      'first due in a later month',
      20241001,
      null,
      '2024-10-01',
      '2024-08-01',
      '2024-10-01',
      2,
      false,
    ],
    // A stored date that froze in the past must not reserve the bill forever.
    [
      'stored date frozen in the past',
      20240925,
      null,
      '2024-09-25',
      '2024-11-01',
      '2024-11-25',
      0,
      false,
    ],
    // Last month's bill linked on 10/02 is outside the week before 10/30.
    [
      "last month's late payment",
      20241030,
      20241002,
      '2024-09-30',
      '2024-10-01',
      '2024-10-30',
      0,
      false,
    ],
  ] as const)(
    '%s',
    async (
      _,
      storedNextDate,
      linkedDate,
      ruleStart,
      month,
      nextDate,
      monthsRemaining,
      settledThisMonth,
    ) => {
      mockSchedule(storedNextDate, linkedDate, ruleStart);

      const claims = await getScheduleReservationClaims(
        template_lines,
        month,
        defaultCategory,
        defaultCurrency,
      );

      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({
        nextDate,
        monthsRemaining,
        settledThisMonth,
      });
    },
  );

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
    vi.mocked(aqlQuery).mockResolvedValue({ data: [], dependencies: [] });
    vi.mocked(db.first).mockImplementation(
      async (_query: string, params?: unknown[]) =>
        (params as string[] | undefined)?.[0] === 'Test Schedule'
          ? { id: 1, completed: 0 }
          : null,
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
