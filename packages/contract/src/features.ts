/** Source-controlled product capabilities, shared by every surface. */
export const FEATURES: Readonly<{ purchases: boolean }> = {
  purchases: false,
};

export const isPurchasesPath = (path: string): boolean =>
  ["/receipts", "/products", "/reports/items"].some(
    (root) => path === root || path.startsWith(`${root}/`),
  );

export const isPageEnabled = (path: string): boolean =>
  FEATURES.purchases || !isPurchasesPath(path);
