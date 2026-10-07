import React from 'react';

import {
  initServer,
  serverPush,
} from '@actual-app/core/platform/client/connection';
import { render, screen } from '@testing-library/react';

import { ReservationsProvider, useReservedTotal } from './ReservationsContext';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

vi.mock('#hooks/useFeatureFlag', () => ({ useFeatureFlag: () => true }));

const month = '2026-10';

function Reserved() {
  return <span>reserved {useReservedTotal(month, ['cat'])}</span>;
}

describe('ReservationsProvider', () => {
  let reserved: number;

  beforeEach(() => {
    reserved = 100;
    initServer({
      'budget/get-reservations': async () => [
        {
          categoryId: 'cat',
          categoryName: 'Cat',
          balance: 0,
          reserved,
          spare: 0,
          accrued: 0,
          shortfall: 0,
          target: 0,
          status: null,
          claims: [],
        },
      ],
    });
  });

  it('refetches after a sync change', async () => {
    render(
      <ReservationsProvider months={[month]}>
        <Reserved />
      </ReservationsProvider>,
    );
    await screen.findByText('reserved 100');

    reserved = 250;
    serverPush('sync-event', { type: 'applied', tables: ['transactions'] });

    await screen.findByText('reserved 250');
  });

  it('refetches after a cell in a shown month changes', async () => {
    render(
      <ReservationsProvider months={[month]}>
        <Reserved />
      </ReservationsProvider>,
    );
    await screen.findByText('reserved 100');

    reserved = 300;
    serverPush('cells-changed', [
      { name: 'budget202610!leftover-cat', value: 1 },
    ]);

    await screen.findByText('reserved 300');
  });
});
