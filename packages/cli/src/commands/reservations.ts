import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { withConnection } from '#connection';
import { printOutput } from '#output';

type Reservations = Awaited<ReturnType<typeof api.getReservations>>;

function summaryRows(reservations: Reservations) {
  return reservations.map(r => ({
    categoryName: r.categoryName,
    balance: r.balance,
    reserved: r.reserved,
    spare: r.spare,
    status: r.status,
  }));
}

function claimRows(reservations: Reservations) {
  return reservations.flatMap(r =>
    r.claims.map(c => ({
      categoryName: r.categoryName,
      name: c.name,
      nextDate: c.nextDate,
      target: c.target,
      accrued: c.accrued,
      reserved: c.reserved,
      settledThisMonth: c.settledThisMonth,
      fixed: c.fixed,
    })),
  );
}

export function registerReservationsCommand(program: Command) {
  const reservations = program
    .command('reservations')
    .description('Show what a category balance owes and what is spare');

  const addSubcommand = (
    name: string,
    description: string,
    rows: (reservations: Reservations, format: string) => unknown,
  ) =>
    reservations
      .command(`${name} <month>`)
      .description(description)
      .option('--category <id>', 'Narrow to a single category')
      .action(async (month: string, cmdOpts) => {
        const opts = program.opts();
        await withConnection(
          opts,
          async () => {
            const result = await api.getReservations(month, {
              categoryId: cmdOpts.category,
            });
            printOutput(rows(result, opts.format), opts.format);
          },
          { mutates: false },
        );
      });

  addSubcommand(
    'list',
    'Reserved and spare per category (YYYY-MM). Table and CSV omit the per-claim detail; use `claims` for that.',
    (result, format) => (format === 'json' ? result : summaryRows(result)),
  );

  addSubcommand(
    'claims',
    'One row per claim: what it is owed and what is set aside',
    result => claimRows(result),
  );
}
