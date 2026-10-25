import React from 'react';
import type { ReactNode } from 'react';

import {
  initServer,
  serverPush,
} from '@actual-app/core/platform/client/connection';
import { render, screen, waitFor } from '@testing-library/react';

import { createTestAppStore, TestProviders } from '#mocks';

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
  let store: ReturnType<typeof createTestAppStore>;

  function wrapper({ children }: { children: ReactNode }) {
    return <TestProviders store={store}>{children}</TestProviders>;
  }

  beforeEach(() => {
    reserved = 100;
    store = createTestAppStore();
    initServer({
      'budget/get-reservations': async () => [
        {
          categoryId: 'cat',
          categoryName: 'Cat',
          balance: 0,
          reserved,
          spare: 0,
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
      { wrapper },
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
      { wrapper },
    );
    await screen.findByText('reserved 100');

    reserved = 300;
    serverPush('cells-changed', [
      { name: 'budget202610!leftover-cat', value: 1 },
    ]);

    await screen.findByText('reserved 300');
  });

  it('says so when reservations fail to load', async () => {
    initServer({
      'budget/get-reservations': async () => {
        throw new Error('no such schedule');
      },
    });
    render(
      <ReservationsProvider months={[month]}>
        <Reserved />
      </ReservationsProvider>,
      { wrapper },
    );

    await waitFor(() =>
      expect(store.getState().notifications.notifications).toEqual([
        expect.objectContaining({
          id: 'reservations-failed',
          type: 'error',
          message: expect.stringContaining('no such schedule'),
        }),
      ]),
    );
  });
});
