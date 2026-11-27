import { createAsyncLogic, setup, types } from "xstate";

/** A save asked of the pane, and who hears whether it landed. */
export interface Submit {
  readonly save: () => Promise<unknown>;
  readonly settled: (saved: boolean) => void;
}

const run = createAsyncLogic<unknown, Submit["save"]>({ run: ({ input }) => input() });

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The pane's save: editing until a submit, then saving until the write lands or fails. While it
 * saves, nothing in the pane takes input and nothing closes it; a failure goes back to editing with
 * what went wrong.
 */
export const paneSaveMachine = setup({
  schemas: {
    context: types<{ error: string | null; pending: Submit | null }>(),
    events: {
      submit: types<Submit>(),
      reset: types<{}>(),
    },
  },
  actors: { run },
}).createMachine({
  id: "paneSave",
  context: { error: null, pending: null },
  initial: "editing",
  states: {
    editing: {
      on: {
        submit: ({ event }) => ({ target: "saving", context: { error: null, pending: event } }),
        reset: () => ({ context: { error: null, pending: null } }),
      },
    },
    saving: {
      invoke: {
        src: "run",
        input: ({ context }) => context.pending!.save,
        onDone: ({ context }, enq) => {
          enq(() => context.pending?.settled(true));
          return { target: "editing", context: { error: null, pending: null } };
        },
        onError: ({ context, event }, enq) => {
          enq(() => context.pending?.settled(false));
          return { target: "editing", context: { error: message(event.error), pending: null } };
        },
      },
      on: {
        submit: ({ event }, enq) => {
          enq(() => event.settled(false));
          return {};
        },
      },
    },
  },
});
