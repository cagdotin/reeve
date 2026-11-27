import type { Output } from "@reeve/contract/operations";
import { toastManager } from "@reeve/ui/components/toast";

const TITLES = {
  "templates-applied": "Targets applied",
  "templates-up-to-date": "Everything is budgeted already",
  "template-errors": "Some targets could not run",
} as const;

/** Toasts what applying targets did, with the categories whose targets failed. */
export const toastTemplates = (result: Output<"apply_templates">) =>
  toastManager.add({
    type: result.errors.length > 0 ? "warning" : "success",
    title: TITLES[result.message],
    description:
      result.errors.length > 0
        ? result.errors.join("\n")
        : `${result.applied} ${result.applied === 1 ? "category" : "categories"} budgeted`,
  });
