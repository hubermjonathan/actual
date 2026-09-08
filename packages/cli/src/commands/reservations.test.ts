import * as api from '@actual-app/api';
import { Command } from 'commander';

import { printOutput } from '#output';

import { registerReservationsCommand } from './reservations';

vi.mock('@actual-app/api', () => ({
  getReservations: vi.fn().mockResolvedValue([]),
}));

vi.mock('#connection', () => ({
  withConnection: vi.fn((_opts, fn) => fn()),
}));

vi.mock('#output', () => ({
  printOutput: vi.fn(),
}));

const category = {
  categoryId: 'cat-1',
  categoryName: 'Needs',
  balance: 564579,
  reserved: 446079,
  allowance: 118500,
  committed: 564579,
  spare: 0,
  accrued: 446079,
  shortfall: 0,
  target: 1053000,
  status: 'onPace' as const,
  claims: [
    {
      name: 'BMW Insurance',
      target: 105300,
      nextDate: '2026-11-01',
      monthlyRate: 17550,
      monthsRemaining: 3,
      accrued: 52650,
      reserved: 52650,
      shortfall: 0,
      onTrack: true,
      fixed: true,
    },
  ],
  allowances: [{ label: 'groceries', amount: 100000 }],
};

function createProgram(format = 'json'): Command {
  const program = new Command();
  program.option('--format <format>');
  program.option('--server-url <url>');
  program.option('--password <pw>');
  program.option('--data-dir <dir>');
  program.exitOverride();
  registerReservationsCommand(program);
  program.setOptionValue('format', format);
  return program;
}

async function run(args: string[], format = 'json') {
  const program = createProgram(format);
  await program.parseAsync(['node', 'test', ...args]);
}

describe('reservations commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getReservations).mockResolvedValue([category]);
  });

  describe('reservations list', () => {
    it('asks the API for the month', async () => {
      await run(['reservations', 'list', '2026-09']);

      expect(api.getReservations).toHaveBeenCalledWith('2026-09', {
        categoryId: undefined,
      });
    });

    it('narrows to one category', async () => {
      await run(['reservations', 'list', '2026-09', '--category', 'cat-1']);

      expect(api.getReservations).toHaveBeenCalledWith('2026-09', {
        categoryId: 'cat-1',
      });
    });

    it('prints the whole payload as json', async () => {
      await run(['reservations', 'list', '2026-09']);

      expect(printOutput).toHaveBeenCalledWith([category], 'json');
    });

    it('drops the nested detail for table output', async () => {
      // One value per cell: `claims` would render as [object Object].
      await run(['reservations', 'list', '2026-09'], 'table');

      expect(printOutput).toHaveBeenCalledWith(
        [
          {
            categoryName: 'Needs',
            balance: 564579,
            reserved: 446079,
            allowance: 118500,
            committed: 564579,
            spare: 0,
            status: 'onPace',
          },
        ],
        'table',
      );
    });

    it('prints an empty status rather than null', async () => {
      vi.mocked(api.getReservations).mockResolvedValue([
        { ...category, status: null },
      ]);

      await run(['reservations', 'list', '2026-09'], 'csv');

      expect(printOutput).toHaveBeenCalledWith(
        [expect.objectContaining({ status: '' })],
        'csv',
      );
    });
  });

  describe('reservations claims', () => {
    it('flattens one row per claim, tagged with its category', async () => {
      await run(['reservations', 'claims', '2026-09'], 'table');

      expect(printOutput).toHaveBeenCalledWith(
        [
          {
            categoryName: 'Needs',
            name: 'BMW Insurance',
            nextDate: '2026-11-01',
            target: 105300,
            accrued: 52650,
            reserved: 52650,
            shortfall: 0,
            onTrack: true,
            fixed: true,
          },
        ],
        'table',
      );
    });

    it('returns nothing when no category has a claim', async () => {
      vi.mocked(api.getReservations).mockResolvedValue([
        { ...category, claims: [] },
      ]);

      await run(['reservations', 'claims', '2026-09']);

      expect(printOutput).toHaveBeenCalledWith([], 'json');
    });
  });
});
