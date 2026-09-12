import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { withConnection } from '#connection';
import { printOutput } from '#output';

type Reservations = Awaited<ReturnType<typeof api.getReservations>>;

/**
 * `table` and `csv` are one value per cell, so the nested `claims` and
 * `allowances` are dropped from the summary and given their own subcommand.
 * `json` always carries the whole payload.
 */
function summaryRows(reservations: Reservations) {
  return reservations.map(r => ({
    categoryName: r.categoryName,
    balance: r.balance,
    reserved: r.reserved,
    allowance: r.allowance,
    committed: r.committed,
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
      shortfall: c.shortfall,
      onTrack: c.onTrack,
      fixed: c.fixed,
    })),
  );
}

export function registerReservationsCommand(program: Command) {
  const reservations = program
    .command('reservations')
    .description('Show what a category balance owes and what is spare');

  // Both subcommands read the same data and differ only in the rows they
  // print, so they share one registration.
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
    'Reserved, allowance and spare per category (YYYY-MM). Table and CSV omit the per-claim detail; use `claims` for that.',
    (result, format) => (format === 'json' ? result : summaryRows(result)),
  );

  addSubcommand(
    'claims',
    'One row per claim: what it is owed and what is set aside',
    result => claimRows(result),
  );
}
