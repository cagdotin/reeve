import type { OperationName } from "@reeve/contract/catalog";
import { createClient } from "@reeve/contract/client";
import { createOperations, type Input, type Output } from "@reeve/contract/operations";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toastManager } from "@reeve/ui/components/toast";

const origin = typeof window === "undefined" ? "" : window.location.origin;

export const api = createClient(origin);
export const { run } = createOperations(origin);

export type { Input, Output };

/** Every query of a book starts with its id, so a change in the book refreshes all of them. */
export const bookKey = (book: string) => ["book", book] as const;

/** Whether the server answers at all; the app shows nothing else until it does. */
export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: () => api.request("GET /api/health", {}),
  retry: 1,
  staleTime: Infinity,
});

export const connectionQuery = queryOptions({
  queryKey: ["connection"],
  queryFn: () => api.request("GET /api/connection", {}),
  staleTime: Infinity,
});

export const booksQuery = queryOptions({
  queryKey: ["books"],
  queryFn: () => run("list_books", {}),
});

/** An operation that reads a book, as a query keyed by the book, the operation and its input. */
export const bookQuery = <K extends OperationName>(
  book: string,
  name: K,
  input: Omit<Input<K>, "book">,
) =>
  queryOptions({
    queryKey: [...bookKey(book), name, input] as const,
    queryFn: () => run(name, { ...input, book } as Input<K>),
  });

export const showError = (error: Error) =>
  toastManager.add({ type: "error", title: error.message });

/**
 * An operation that writes to a book. It refreshes the book's queries when it settles (the change
 * feed does too, for other windows and agents) and toasts a failure, unless `quiet` because the
 * caller shows it, as an editor in the pane does.
 */
export const useBookMutation = <K extends OperationName>(
  book: string,
  name: K,
  { quiet = false }: { quiet?: boolean } = {},
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Input<K>, "book">) => run(name, { ...input, book } as Input<K>),
    ...(quiet ? {} : { onError: showError }),
    // Not awaited: the caller learns the write landed without waiting for every query to refetch.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: bookKey(book) });
    },
  });
};

/** A write outside any book: creating, switching or deleting books. */
export const useAppMutation = <K extends OperationName>(name: K) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input<K>) => run(name, input),
    onError: showError,
    onSettled: () => queryClient.invalidateQueries(),
  });
};

/**
 * A book write that removes what the page shows (deleting or merging it): `leave` navigates away
 * first, because the change feed refreshes the book the moment the write lands and the old page
 * would ask for what is gone.
 */
export const useLeavingMutation = <K extends OperationName>(
  book: string,
  name: K,
  leave: (input: Omit<Input<K>, "book">) => Promise<unknown>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Input<K>, "book">) => {
      await leave(input);
      return run(name, { ...input, book } as Input<K>);
    },
    onError: showError,
    onSettled: () => queryClient.invalidateQueries({ queryKey: bookKey(book) }),
  });
};
