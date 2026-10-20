import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { get } from './api';
import type { Bootstrap, BudgetMonth } from './types';

export function useBootstrap() {
  return useQuery({ queryKey: ['bootstrap'], queryFn: () => get<Bootstrap>('/api/bootstrap') });
}

/** Lookups over the bootstrap data that most screens need. */
export function useLookups() {
  const { data } = useBootstrap();
  return useMemo(() => {
    const accounts = data?.accounts ?? [];
    const groups = data?.groups ?? [];
    const categories = groups.flatMap((g) => g.categories.map((c) => ({ ...c, group: g })));
    return {
      data,
      base: data?.settings.baseCurrency ?? 'EUR',
      accounts,
      openAccounts: accounts.filter((a) => !a.closed),
      groups,
      categories,
      account: (id: string | null | undefined) => accounts.find((a) => a.id === id),
      category: (id: string | null | undefined) => categories.find((c) => c.id === id),
      payees: data?.payees ?? [],
    };
  }, [data]);
}

export function useBudget(month: string) {
  return useQuery({ queryKey: ['budget', month], queryFn: () => get<BudgetMonth>(`/api/budget/${month}`), placeholderData: (prev) => prev });
}

/** Wraps a write and refreshes everything that may depend on it. */
export function useWrite<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries(),
  });
}
