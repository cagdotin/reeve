import { FEATURES } from "@reeve/contract/features";
import { notFound } from "@tanstack/react-router";

/** A frozen route stops before its component or queries mount. */
export const requirePurchases = () => {
  if (!FEATURES.purchases) throw notFound();
};
