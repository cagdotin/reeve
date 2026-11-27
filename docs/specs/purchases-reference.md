# Purchases implementation reference, pre-freeze

## Status and baseline

This document records the implementation at commit `7d2dcbaa288a8f30f05d438eaa32a9f0914e0767`, obtained with `git rev-parse HEAD` before the freeze changes. Paths and symbols below refer to that commit. The snapshot describes implemented behavior, not an approved design for future work.

Purchases, receipts, products, and item categories are frozen and hidden while reeve focuses on finance. The freeze retains the enabled implementation and tests behind the source-controlled `FEATURES.purchases = false` capability. That capability is a freeze mechanism, not a plugin interface. The eventual built-in or plugin shape is undecided. [Purchases needs](purchases-needs.md) separates confirmed intent from candidate jobs.

All examples here are synthetic. No real book or private purchase data was inspected. Source and test inspection informed this reference. This documentation change does not claim a runtime test run.

The earlier rationale for receipts, auto-apply and the receipts and products pages is in git history (`git log -- docs/decisions`). It explains earlier choices. They do not settle the return architecture.

## Source map

| Concern                                                    | Baseline source                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Inputs, outputs, operation metadata, CLI declarations      | `packages/contract/src/catalog/receipts.ts`                                                                      |
| Browser-safe arithmetic, text matching, units, split plans | `packages/contract/src/receipts.ts`                                                                              |
| Tables and foreign keys                                    | `packages/engine/src/receipts/schema.ts`                                                                         |
| Handler composition and auto-apply triggers                | `packages/engine/src/receipts/handlers.ts`, `auto.ts`                                                            |
| Receipt writes and JSON import                             | `packages/engine/src/receipts/receipts.ts`                                                                       |
| Receipt reads, computed status, warnings                   | `packages/engine/src/receipts/view.ts`                                                                           |
| Paying ledger side and payment claims                      | `packages/engine/src/receipts/ledger.ts`, `matching.ts`                                                          |
| Split loading, comparison, preview, application            | `packages/engine/src/receipts/split.ts`, `apply.ts`                                                              |
| Category inheritance and trees                             | `packages/engine/src/receipts/context.ts`, `categories.ts`                                                       |
| Products, aliases, assignment                              | `packages/engine/src/receipts/products.ts`, `aliases.ts`, `assign.ts`                                            |
| Unit price history, changes, store ranking, spending       | `packages/engine/src/receipts/prices.ts`                                                                         |
| Receipt overview and server-side list behavior             | `packages/engine/src/receipts/receipt-activity.ts`                                                               |
| Product overview and product summaries                     | `packages/engine/src/receipts/product-activity.ts`                                                               |
| Files and photo metadata                                   | `packages/engine/src/receipts/photos.ts`                                                                         |
| Ledger compatibility callbacks                             | `packages/engine/src/receipts/references.ts`, `packages/engine/src/operations.ts`                                |
| Backup and file ownership                                  | `packages/engine/src/imports/export.ts`, `packages/engine/src/home.ts`                                           |
| Photo streaming outside the JSON catalog                   | `packages/server/src/receipt-photos.ts`                                                                          |
| Pages                                                      | `apps/web/src/routes/receipts.index.tsx`, `receipts.$receipt.tsx`, `products.index.tsx`, `products.$product.tsx` |
| Receipt and product controls                               | `apps/web/src/components/receipts/`, `apps/web/src/components/products/`                                         |
| Register integration                                       | `apps/web/src/components/register/receipt-cells.tsx`                                                             |
| Client-side page models                                    | `apps/web/src/lib/receipts.ts`, `receipt-pages.ts`, `products.ts`                                                |
| Navigation and bundled documentation                       | `apps/web/src/lib/nav.ts`, `docs.ts`                                                                             |

Unless a table gives a complete path, file names in the following sections refer to `packages/engine/src/receipts/`.

## Domain and persistence

A book remains one SQLite file. Receipt photos are separate files owned by that book. Receipt tables point to ledger entities. Ledger tables do not point back to receipts.

There is no separate purchases table. A receipt line is a purchase fact with a stable ID, even when it has no product. A product names a thing across receipts. An item category says what a thing is, independently of the budget category that receives its spending. A store is a ledger payee, not a separate entity.

Money totals are signed integer minor units in the book's currency. Purchases and outgoing payment claims are positive. Refund receipts and their payment claims are negative. Register outflows have the opposite sign. Public dates are `YYYY-MM-DD`, stored as integer `YYYYMMDD`. Quantities, package sizes, and unit prices use real numbers. Unit prices may include fractions of a minor unit.

### Tables

Every table has a text primary key `id`.

| Table                 | Stored fields beyond `id`                                                                                                                                                                                                | Relationships and deletion                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receipts`            | `payee_id`, `date`, optional `time`, signed `total`, optional `notes`, optional `external_id`, `auto_applied`, `created_at`                                                                                              | Payee deletion sets the store to null. Non-null external IDs are unique within the book.                                                           |
| `receipt_lines`       | `receipt_id`, one-based `position`, raw `text`, optional `code`, `quantity`, optional `unit`, optional `unit_price`, `line_total`, optional `pack_size`, `product_id`, `item_category_id`, `budget_category_id`, `notes` | Receipt deletion cascades. Product, item category, and budget category deletion set their references to null unless an operation moves them first. |
| `receipt_adjustments` | `receipt_id`, `position`, `kind`, signed `amount`, optional `description`                                                                                                                                                | Receipt deletion cascades.                                                                                                                         |
| `receipt_payments`    | `receipt_id`, `transaction_id`, signed `amount`, `created_at`                                                                                                                                                            | Receipt and transaction deletion cascade. The receipt and transaction pair is unique. Both sides can have multiple partners.                       |
| `receipt_photos`      | `receipt_id`, `position`, `file_name`, `mime_type`, `size`, `sha256`, `created_at`                                                                                                                                       | Receipt deletion cascades metadata. File handling is separate.                                                                                     |
| `products`            | `name`, optional `parent_id`, optional `item_category_id`, `unit`, optional paired `size` and `size_unit`, `notes`, `archived`, `created_at`                                                                             | Generic parents group specific kinds. Item-category deletion sets null unless moved first.                                                         |
| `product_aliases`     | `product_id`, optional `payee_id`, printed `text`, normalized `key`, optional `code`, optional `pack_size`, `rejected`, `created_at`                                                                                     | Product and payee deletion cascade. A null payee means any store. Rejection is per product and matching scope, not a ban on the text itself.       |
| `item_categories`     | `name`, optional `parent_id`, optional `budget_category_id`, `hidden`, `sort_order`, `created_at`                                                                                                                        | A tree without the budget category depth limit. Budget-category deletion sets null unless moved first.                                             |

The schema indexes receipt dates and stores, tree parents, line receipt and product references, payment transactions, alias keys and codes, and photo receipts. `schema.ts` is authoritative for defaults and index definitions. `packages/engine/src/db/open.ts` includes all eight tables in `UNDONE_TABLES`.

### Category resolution

`context.ts` computes effective categories on read, without copying inherited values onto lines.

1. A line's item category is its explicit `itemCategoryId`, otherwise the nearest product or product ancestor with an item category.
2. A line's budget category is its explicit `budgetCategoryId`, otherwise the nearest budget category on that effective item category or its ancestors.
3. No matching default leaves the budget category unresolved.

Null means inherit, not explicitly opt out of inheritance. Budget categories are ledger expense or income categories. Product identity is not required for categorization if the line has its own category. Product and item-category moves reject cycles.

Deleting an item category lifts its children to its parent and moves products and lines that name it to that parent. Deleting a product lifts its kinds, leaves its receipt lines unassigned through the foreign key, and removes its aliases. Descendant lines can change effective category because their ancestor changed. Merging products moves lines and aliases to the target, moves kinds under the target, and deletes the merged products. A merge into a descendant is rejected. Duplicate alias scopes retain the target's alias.

## Arithmetic and units

The shared implementation is `packages/contract/src/receipts.ts`. Engine and browser use the same functions.

### Line totals and warnings

`lineAmount(quantity, unitPrice)` multiplies the operands as decimals derived from their shortest numeric text, then rounds the product to whole minor units, halfway away from zero. BigInt multiplication avoids binary floating-point midpoint errors. Each line rounds before totals are summed.

| Input in minor units | Computed result                                |
| -------------------- | ---------------------------------------------- |
| `0.5 * 201`          | `101`                                          |
| Two such lines       | `202`, not a rounded combined product of `201` |
| `-0.5 * 201`         | `-101`                                         |
| `1.005 * 100`        | `101`                                          |
| `3 * 33.335`         | `100`                                          |

An explicit `lineTotal` wins over the computed value. `lineMismatch` warns only when the difference exceeds one minor unit. A warning does not reject the line. A new quantity or unit price recomputes an existing line's total when there is a unit price and no explicit replacement total.

`receiptTotals` defines:

- `itemsTotal` as the sum of stored line totals.
- `adjustmentsTotal` as the sum of signed adjustments.
- `expectedTotal` as their sum.
- `difference` as the receipt's printed total minus `expectedTotal`.
- `balanced` as `abs(difference) <= 1`.
- `paidAmount` as the sum of payment claims.
- `matched` as at least one payment and `paidAmount === total`, with no one-cent tolerance.

For lines totaling 1,000 and tax of 80, a total of 1,081 is balanced with difference 1. Payments totaling 1,080 do not match that receipt. Adjustment kinds are `tax`, `discount`, `coupon`, `tip`, `deposit`, `fee`, `rounding`, and `other`. Their kinds label the record. Their signed amounts drive the calculation.

### Exact allocation

`allocate(total, weights)` uses largest remainders. It floors each proportional share, then gives remaining minor units to descending fractional remainders, breaking ties by input order. Shares sum exactly to the supplied integer total when weights exist.

- `allocate(100, [1, 1, 1])` is `[34, 33, 33]`.
- `allocate(950, [1000, -100])` is `[1056, -106]`, preserving a returned item's negative share.
- If weights sum to zero, absolute weights become the basis. With all-zero weights, the first entry receives the total.
- With no entries, the result is empty. A receipt without lines cannot distribute its money.

Item spending allocates the receipt's printed total across individual lines. Ledger application first aggregates line totals by budget category, then allocates the payment share across categories. These are separate allocations, so their rounding boundaries differ.

### Normalized prices

Units are `piece`, `pack`, `g`, `kg`, `ml`, `l`, `oz`, `lb`, and `fl_oz`. Dimensions are count, mass, and volume. A pack is one counted item until `packSize` expands it. Conversion factors use grams and millilitres: kilogram 1,000, ounce 28.349523125, pound 453.59237, litre 1,000, and fluid ounce 29.5735295625.

`baseQuantity` converts measured lines directly within a dimension. Counted lines use `quantity * (packSize ?? 1)`. For a mass or volume product, counted pieces also require the product's package size. Price readers use the nearest available product ancestor's size when necessary. Incompatible dimensions or missing required sizes yield null, not a guessed conversion.

`pricePerBase` divides the stored line total by the positive base quantity and rounds to four decimal places in minor units. It does not allocate receipt-wide tax or discounts into the unit price.

For a product measured in litres with a package size of 500 ml, two pieces costing 150 minor units contain one litre and cost 150 per litre. One six-pack costing 450 contains three litres and also costs 150 per litre. A 250 g line costing 100 costs 400 per kilogram. A kilogram line cannot establish a price for a litre product.

## Operation catalog inventory

Every operation below is declared in `packages/contract/src/catalog/receipts.ts` and dispatched through `handlers.ts`. The catalog carries exact input fields, nullability, output schemas, read or write classification, HTTP metadata, and available CLI forms. These operation names are historical interfaces, not a promise to expose them while frozen.

| Group                       | Operations                                                                                                           | Implementation                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Receipt creation and import | `create_receipt`, `import_receipts`                                                                                  | `receipts.ts`                    |
| Receipt reads and overview  | `get_receipt`, `list_receipts`, `receipt_activity`                                                                   | `view.ts`, `receipt-activity.ts` |
| Header changes and deletion | `update_receipt`, `delete_receipt`                                                                                   | `receipts.ts`                    |
| Lines                       | `add_receipt_lines`, `update_receipt_line`, `delete_receipt_lines`, `reorder_receipt_lines`                          | `receipts.ts`                    |
| Adjustments                 | `add_receipt_adjustment`, `update_receipt_adjustment`, `delete_receipt_adjustment`                                   | `receipts.ts`                    |
| Payment matching            | `suggest_receipt_matches`, `link_receipt_payment`, `unlink_receipt_payment`, `auto_match_receipts`                   | `matching.ts`                    |
| Register receipt lookup     | `list_transaction_receipts`, `transactions_with_receipts`                                                            | `matching.ts`                    |
| Ledger application          | `receipt_split_preview`, `apply_receipt_to_transaction`                                                              | `split.ts`, `apply.ts`           |
| Evidence files              | `attach_receipt_photo`, `list_receipt_photos`, `get_receipt_photo`, `delete_receipt_photo`                           | `photos.ts`                      |
| Item-category tree          | `list_item_categories`, `create_item_category`, `update_item_category`, `move_item_category`, `delete_item_category` | `categories.ts`                  |
| Product identity            | `list_products`, `get_product`, `create_product`, `update_product`, `delete_product`, `merge_products`               | `products.ts`                    |
| Alias memory                | `list_aliases`, `create_alias`, `delete_alias`, `reject_alias`                                                       | `aliases.ts`                     |
| Product assignment          | `assign_line_product`, `suggest_products`, `list_unassigned_lines`                                                   | `assign.ts`                      |
| Prices and spending         | `product_price_history`, `price_changes`, `cheapest_stores`, `item_spending`                                         | `prices.ts`                      |
| Product overview            | `product_activity`, `product_summary`                                                                                | `product-activity.ts`            |

Book operations use the ordinary runner's validation, transaction, undo, and change-feed behavior. Unknown input keys are invalid. Output objects are not input objects. CLI groups include `receipts`, `products`, and `items`; complex arrays are not all expressible as CLI flags. `import_receipts` accepts JSON content or a file path for atomic creation with nested lines, adjustments, and payments. HTTP, MCP, CLI, and generated agent skill entries derive from the catalog, rather than separate handwritten implementations.

### Creation and editing

`create_receipt` accepts a header with optional nested lines, adjustments, and payment links. A store name finds or creates a payee. An explicit store ID takes precedence. Lines preserve printed text and code separately from product identity. Missing quantity defaults to one. Each line needs a total or unit price. Blank line text, non-finite quantity or price, unsafe integer totals, and invalid references are rejected.

A nonblank `externalId` makes creation idempotent. Repeating it returns the existing receipt with `created: false`; it does not merge or replace contents. Updating an external ID refuses another receipt's ID. Creation returns the receipt and up to five payment suggestions if it is not matched.

`import_receipts` reads a single receipt or an array. It accepts exactly one of `path` and `content`, parses JSON, decodes receipt inputs, and calls the same creation function. The operation transaction covers the batch. A rejected line rolls back the write rather than leaving a partial receipt.

Create, import, and header update reject a zero receipt total. Older zero-total rows remain readable. Negative totals represent refunds. Lines may have negative or zero totals independently of the header. Partial line reorders put named IDs first and preserve omitted IDs afterward. Line insertion and deletion renumber positions.

## Receipt lifecycle

Status is computed on each read. No persisted stage or historical stage timeline exists.

- `balanced` and `matched` follow the arithmetic above.
- `categorized` requires at least one line and every line to resolve to a budget category.
- `applied` requires at least one payment and every linked transaction to carry the category plan for all receipts claiming it.
- `autoApplied` exposes the stored provenance flag only while computed `applied` is true.

The first false flag determines the displayed stage: `balance`, `match`, `categorize`, `apply`, then `finished`. Flags remain independent. An already-applied receipt that stops adding up returns to the balance stage. A transaction whose categories already equal the plan reads as applied without an Apply action. Applied status does not prove that a person approved it or that every other flag is true.

Warnings report explicit line-total mismatches, unbalanced receipts with lines, and linked amounts that underpay or overpay the total. Product assignment and budget categorization are separate completion jobs.

### Matching and payment claims

Candidates must have exactly one posting on an asset or liability account. Transfers and other transactions without one paying side are excluded. The candidate date window is inclusive, three days before through ten days after the receipt. Amounts are evaluated as money paid out, opposite the register sign.

The required amount is the receipt total less existing claims. Candidate availability is its outgoing amount less all other receipt claims. Already-linked transactions are excluded from suggestions. Availability must match the required amount exactly or exceed it in the same direction by at most 30 percent, as a possible tip. Smaller available amounts are not suggested, though manual partial payment links are supported.

`scoreMatch` combines 50 percent amount, 25 percent date, and 25 percent payee, rounded to three decimals. Exact amount scores one for the amount component. A tip scores `0.6 - excessRatio`. Date proximity declines linearly using the asymmetric window. Payee identity scores one. Otherwise, the best similarity against the transaction's normal and imported payee names is used. Normalized name equality scores one, qualifying containment scores 0.8, and other names use trigram Dice similarity. A similarity of at least 0.5 counts as a similar payee. Results carry reasons and sort by score, then absolute day distance.

A sure match is exact, within three days either way, and has payee similarity at least 0.5. `auto_match_receipts` considers only receipts with no payments and nonzero totals. It links a receipt only when it has one sure candidate and no other singly-proposed receipt wants that same transaction. Multiple sure candidates or a shared proposal are reported as ambiguous. It never resolves ambiguity by order.

`link_receipt_payment` upserts the unique pair. It verifies transaction direction, a nonzero safe integer claim, and the amount still free after other receipts. With no amount, it takes the lesser magnitude of what this receipt still needs and what the transaction has free. Existing claims for the same pair are excluded when recalculating that pair. An explicit amount can overpay the receipt within the transaction's available amount, producing a warning. Unlinking removes the claim without changing ledger postings.

### Split preview and manual application

`receipt_split_preview` reads the same plan that application writes. It requires a named transaction when several pay the receipt. Manual apply can name and link a previously unlinked transaction, or apply every already-linked transaction. Each transaction's plan includes every receipt claiming it, not only the receipt named by the caller.

`planSplit` groups a receipt's line totals by effective budget category and allocates its payment share proportionally. Signed weights support returns. Tax, discounts, and other adjustments follow the line proportions because the payment amount, rather than just item totals, is allocated. Lines without categories or receipts without lines refuse the plan. Manual application does not require the receipt's balanced and matched flags to be true. Those stricter readiness conditions belong to auto-apply.

Unclaimed transaction money follows these rules:

1. A non-null `remainderCategory` receives it when supplied.
2. Otherwise, with exactly one receipt and a same-direction remainder no larger than 30 percent of its claim, the remainder spreads across its categories too.
3. Otherwise, the remainder stays on the transaction's current single category, including Uncategorized.
4. For a previously applied split, `apply.ts` recognizes the earlier remainder by posting memo `Not on the receipt`.
5. A split with no identifiable remainder category refuses rather than guessing.

A tested example has category weights Food 633 and Home 300, a receipt claim of 1,000, and bank outflow of 1,200. The 200 tip spreads. Largest-remainder allocation yields Food 814 and Home 386. The register splits are -814 and -386, and the paying posting stays -1,200. The positive expense counterparts total 1,200, so the journal still sums to zero.

An outflow of 1,000 with a single receipt claim of 500 leaves 500 beyond the tip allowance. It stays on the current single category or an explicitly chosen category. An unrelated existing split without a destination is rejected.

`applyReceipt` calls ledger `updateTransaction` with `learn: false`. It changes category splits, not the bank amount, and does not teach categorization rules. The operation is one undo step. Manual apply clears the named receipt's auto-apply provenance. Applied comparison aggregates counterpart amounts by category and permits the single remainder difference without requiring that remainder's category identity to match a fixed category.

### Automatic application

`autoApplyReceipts` is a book setting, off by default. Turning it on performs no retroactive application. The setting is historical stored configuration, separate from the global purchases capability.

`autoApplying` captures touched receipts before and after a receipt-module write. A receipt is eligible only when balanced, matched, and categorized, with exactly one payment transaction that pays no other receipt. It applies only if the after-state is ready and not applied, unless the before-state was already ready and not applied.

This rule preserves a pre-existing divergence from manual ledger editing. A later receipt edit can reapply a previously applied receipt. A ready, unapplied receipt remains untouched until manual apply or a later transition out of readiness and back in. Provenance is not a full audit history, so a readiness cycle can allow another auto-apply after a manual split.

The wrappers cover create and import, header updates, line add/update/delete, adjustment add/update/delete, payment link/unlink, auto-match, product assignment, product update/delete/merge, and item-category update/move/delete. Product assignment with similar-line propagation and tree changes can affect receipts beyond the directly named receipt. `handlers.ts` uses the broad touched scope where needed. Reorders, photos, alias edits, and merely enabling the setting do not initiate application.

Plan refusal through `InvalidRequest` leaves the triggering receipt write successful without an apply. Other failures still propagate. Triggering write and successful automatic application share a transaction, undo step, and change event. Results containing affected receipts are refreshed after application.

## Product identity and purchase analysis

### Aliases and assignment

`normalizeText` applies Unicode NFKC, trims, collapses whitespace, and lowercases. Printed line text remains unchanged. Alias text is trimmed for storage, with its normalized key stored separately.

An omitted product on a new line tries exact aliases in this order: store code, store text, global code, global text. Archived products and rejected product matches are excluded. A step naming multiple products returns no assignment immediately, rather than falling back to a lower-priority step. A successful alias supplies its package size unless the line supplied one. Explicit `productId: null` prevents this creation-time fill.

`suggest_products` never assigns. It offers an exact alias with score one, an exact normalized product name with score 0.95, product word overlap weighted by 0.9, and alias-text overlap weighted by 0.85. The overlap cutoff is 0.34 before weighting. Rejected product matches remain excluded. Each product keeps its highest score, with name as the tie-breaker.

`assign_line_product` changes the selected line's product. Optional `remember` stores a store-scoped alias. Optional `applyToSimilar` fills currently unassigned lines with the same normalized text at the same store, including no-store lines when appropriate. It does not fuzzy-match or overwrite already-assigned lines. This assignment path changes product IDs; it does not recompute alias package sizes for the propagated lines.

`list_unassigned_lines` returns paged line views and suggestions. Its `named` option uses exact active product names or applicable aliases, respecting rejection. That attention predicate is broader than the unique-alias automatic assignment rule. A known exact name is not evidence that the system assigned it.

### Prices, spending, and summaries

`product_price_history` returns ordered purchase points and optionally includes descendant kinds, measured in the requested product's unit. A history point uses the raw line total. `lastPurchases` supplies product list counts and last purchases, not a weighted market estimate.

`price_changes` compares the latest positive normalized price with the previous positive purchase or an arithmetic mean of prior positive prices. With a bounded range, the average uses an equally long inclusive period before the range. The previous-purchase mode can reach farther back. Changes default to a minimum absolute one percent and sort by absolute percentage change. Free and negative-price lines do not establish comparison prices.

`cheapest_stores` includes product descendants, groups positive normalized prices by store, and ranks by latest price, then average. Its engine operation does not enforce freshness. The product page's recommendation prefers prices no older than 180 days and says when none are recent. This is a UI choice, not a global price-history filter.

`item_spending` groups by item category, product, or store. Allocation defaults on, spreading the printed receipt total across all its lines before item-category filtering. Setting `allocate: false` reports raw line totals instead. Null references form explicit unnamed groups. Unmatched and unbalanced receipts still contribute. Receipts without lines cannot contribute a line allocation.

`product_activity` returns each product's own figures and a separate descendant `rollup`, allocated spending, line-count purchases, prior-period figures, recent positive prices, changes, kinds, aliases, and attention checks. Summing own figures does not double-count descendants. Archived and unassigned spending remain visible in totals. A parent with only kinds bought is not another distinct product bought. It returns twelve calendar months ending in the current month. Attention includes unassigned or exactly named lines, active bought products without item categories, likely duplicates, and unmeasurable positive purchases. Duplicate checks use equivalent word-normalized names or shared accepted alias scope, excluding ancestor-kind pairs.

`product_summary` includes descendants over all time, allocated spending, quantity in the requested unit, unmeasured lines, monthly figures, and immediate-kind breakdowns. Purchase counts count lines. The average interval counts distinct purchase days, needs at least three days, and is the first-to-last span divided by one fewer day count. Quantity totals round to three decimals. Parent charts can mix comparable kinds' prices, but parent price-change calculations use the parent's own purchases rather than interpreting a changed kind mix as inflation.

## Baseline user and agent workflows

### Itemize and reconcile

An agent reads a receipt image, PDF, e-mail, or text outside reeve. It submits `create_receipt` or JSON `import_receipts`, preferably with an external ID. reeve runs no OCR or model. Photos are optional evidence, not a completion requirement.

The editor presents raw lines, quantities, prices, totals, adjustments, and derived differences. A person can correct amounts or add a reconciling adjustment. Payment suggestions lead to explicit links or conservative auto-match. A cash purchase finishes through a transaction on a cash account like any other account. There is no separate cash receipt exception.

Lines resolve budget categories directly or through products and item categories. Preview shows the category plan before manual apply. With the setting enabled, a qualifying write applies automatically. Register receipt marks come from `transactions_with_receipts`, not additional fields on `list_transactions`.

### Find unfinished receipts

The receipts index combines range figures, twelve monthly totals, store and category cards, the first-incomplete-stage pipeline, and a server-paged table. `receipt_activity` returns net spending, refunds separately, purchase-only average basket, previous equal-length period, unitemized totals, and ledger coverage. Receipt dates drive receipt totals. Transaction dates drive recorded and covered ledger spending.

Coverage compares net expense postings with same-direction linked claims, capped at each transaction's expense amount. An income-category refund covers no expense spending. Unlinked positive receipt amounts are reported separately. Coverage is not a score for receipt diligence because rent and other non-itemized expense postings remain in its denominator.

Stage counts and headline figures follow the range. Unfinished counts and attention checks span the book. Checks cover unbalanced receipts with lines, no lines, unmatched payment totals, unresolved budget categories, matched but unapplied receipts, line-total warnings, and unfinished receipts older than 30 days. The list and count share predicates. Missing photos are not an attention check.

`list_receipts` filters stages, checks, stores including no store, item categories, dates, text, and legacy status flags. It sorts by date, store, line count, total, or progress before slicing. Computed filters apply across all matching rows, not just the current browser page. Search in the UI goes across all time; ordinary range filters do not. Load more increases the requested limit.

### Maintain product knowledge

The products index combines spending, price movers, category cards, attention checks, and a tree table. Search includes accepted aliases and can find products outside the selected range. Historical query tabs `changes` and `unassigned` retain their meanings. Unassigned lines with equal printed text at one store are grouped for one assignment action.

A product detail shows purchase history, unit prices, store comparisons, aliases, kinds, editable identity and measures, and allocated spending. The raw purchase rows need not sum to the allocated spending tile because tax and receipt adjustments are absent from raw line totals. Archiving hides products from default selection and rankings without removing their money from totals. Destructive actions confirm and describe their effects. Multi-product writes are separate operations and therefore separate undo steps.

Deleting a receipt deletes its lines, adjustments, claims, and evidence metadata. It does not undo previously applied ledger splits. Deleting a product leaves printed receipt lines in place but unassigned. Either deletion can be undone through the ordinary operation history.

## Evidence files and compatibility hooks

### Photo ownership

`attach_receipt_photo` accepts a local path or base64 content, not both. Content needs a filename or MIME type. Empty files and files over 50 MiB are rejected. Supported extension inference includes JPEG, PNG, WebP, GIF, HEIC, HEIF, TIFF, and PDF. An explicit MIME type must be an image type or `application/pdf`. This is type validation, not OCR or a guarantee of decoder support.

Files live at `<home>/receipts/<book>/<receipt>/<position>-<slug>.<extension>`. Metadata includes byte length and SHA-256. `get_receipt_photo` can return base64 only up to 5 MiB; larger files use the returned local path or HTTP stream. Missing files appear with `exists: false` in metadata and fail content reads.

Deleting evidence moves files into the book's `.trash/<receipt>/` directory. When undo restores metadata, photo lookup can move the file back. Trash pruning consults `undo_log` before removing folders no history entry can restore. This is filesystem coordination around SQLite, not a filesystem transaction.

`GET /api/books/:book/receipt-photos/:id/file` is a handwritten binary route, outside catalog-generated JSON endpoints. Its implementation calls `get_receipt_photo` and streams the file with its content type. It needs separate consideration whenever receipt access is disabled.

### Existing-book behavior that outlives hidden screens

- `operations.ts` calls `movePayeeReceipts` before merging payees. Receipts and aliases follow the retained payee.
- Category deletion with a transfer category moves explicit line budget categories and item-category defaults through `moveBudgetCategoryReceipts`.
- Transaction merges carry payment links through `moveTransactionReceipts`, combining amounts when both transactions paid the same receipt. Transfer-link composition also moves payment references.
- Transaction deletion cascades payment claims. Payee deletion clears receipt stores and removes store aliases. These foreign keys remain relevant even with no purchase operations exposed.
- Rule create, update, and preview handlers receive `receiptAppliedTransactions` from the composition root. Recategorization preserves transactions whose applied receipts already determine their splits. This is a ledger-facing compatibility hook outside the receipt catalog.
- `db/open.ts` keeps receipt tables in undo recording. Existing undo and redo entries may mention these tables while the feature is disabled.
- `imports/export.ts` copies photo files into `<backup>.receipts` beside an exported book. Restore uses that sibling directory when present. Backup copies omit `.trash`. Copying only SQLite loses external evidence files. CSV ledger exports are not a receipt interchange format.
- `home.ts` owns receipt folder naming and removes a book's receipt folder when that book is deleted.
- `autoApplyReceipts` and `auto_applied` remain stored historical data. Their retention does not justify active purchase automation while the global capability is off.
- `apps/web/src/lib/docs.ts` eagerly includes `docs/**/*.md` and MDX. New reference documents can appear in the built app even when purchase navigation is hidden unless documentation discovery also filters them.

These hooks distinguish unavailable functionality from data removal. Removing handlers or menus alone is not a complete freeze. Removing persistence or merge hooks would instead change the meaning of existing books.

## Tests and acceptance examples

The following suites are reconstruction evidence at the baseline. They remain useful as enabled-feature acceptance tests. Freeze-specific default-disabled tests are a separate responsibility and do not replace them.

| Tests                                                                              | Acceptance scenarios                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/test/receipts.test.ts`                                            | Atomic nested creation, external-ID replay, raw text, warning rather than rejection for a supplied mismatch, rollback for missing price and total, JSON import, editing and ordering, undo, range and status filters, inherited categories.                                               |
| `packages/engine/test/receipts-arithmetic.test.ts`                                 | Decimal midpoint rounding, per-line rounding, signed adjustments, one-cent tolerance boundaries, fractional prices, allocation with negative weights, unit conversion, matching score boundaries, split plans and remainder refusal.                                                      |
| `packages/engine/test/receipts-matching.test.ts`                                   | Candidate ranking, imported or similar payees, liability payments, claimed funds, transfer exclusion, partial claims, direction rejection, transaction deletion and merge, payee merge, ambiguity, refund apply, multi-receipt transaction, exact bank-total preservation, one-step undo. |
| `packages/engine/test/receipts-auto-apply.test.ts`                                 | Off by default, no retroactive enable, readiness transitions from different writes, similar-line propagation, tree edits, reapply after receipt changes, combined undo, no auto-apply for many-to-many payments, refusal without failed triggering write, manual divergence preservation. |
| `packages/engine/test/receipts-products.test.ts`                                   | Category inheritance and reparenting, category-transfer hooks, alias priority and rejection, ambiguous codes and text, remembered assignment, suggestions, product merge and deletion, size normalization, descendant prices, prior or average comparisons, allocated spending totals.    |
| `packages/engine/test/receipts-photos.test.ts`                                     | File copy and metadata, invalid file kind, photo and receipt deletion with undo, trash expiry, book deletion, backup sidecar export and restore.                                                                                                                                          |
| `packages/engine/test/receipt-activity.test.ts`                                    | Overview figures, refunds and average basket, pipeline and check predicates, coverage, empty-line receipts, range and all-time distinctions, server-wide filtering and sorting.                                                                                                           |
| `packages/engine/test/product-activity.test.ts`                                    | Agreement with allocated item spending, prior-period windows, own versus rollup totals, archived money, movers, incompatible units, free lines, attention, twelve months, interval rules, deletion and undo.                                                                              |
| `packages/engine/test/product-activity-truth.test.ts`                              | Deletion's effect on kinds' categories and auto-apply, exclusion of free or discount prices, historical comparison windows, alias search, named-line count and list agreement.                                                                                                            |
| `packages/engine/test/properties/receipts.test.ts`                                 | Generated receipt arithmetic and ledger behavior invariants.                                                                                                                                                                                                                              |
| `packages/engine/test/found-by-properties/a-receipt-with-a-tip-of-its-own.test.ts` | Regression for applied-status detection when a tip remainder goes to an explicitly named category.                                                                                                                                                                                        |
| `apps/web/src/lib/receipt-pages.test.ts`, `products.test.ts`                       | Client-side page models and filtering semantics.                                                                                                                                                                                                                                          |
| `packages/e2e/test/receipts.e2e.ts`                                                | Receipt apply appears in the real register, automatic apply, pipeline and checks, live typing and adjustment, photo add/open/delete, deletion retains the split, all-time search, zero-total validation, custom ranges.                                                                   |
| `packages/e2e/test/products.e2e.ts`                                                | Movers and checks open matching tables, old query addresses, grouped assignment, product details and aliases, product deletion consequences, archive, creation, category tree, alias search, mixed-selection archive.                                                                     |

The receipt arithmetic fixture is embedded as `FIXTURE` in `receipts-arithmetic.test.ts`, adapted from mggarofalo/Receipts. It is not a separate checked-in JSON file. Cases include two positive midpoint lines, repeated small lines, four-place operands, fractional payments converted to minor units, tax with signed adjustments, exact balance, and one- or two-cent discrepancies in either direction. E2E suites seed synthetic receipts through operations rather than a private receipt collection.

An enabled reconstruction can be checked in a scratch home through the engine suites and the two purchase E2E suites. Default-disabled verification also needs ordinary finance operations on books that already contain receipt data, including merges, category transfer, undo, backup, and restore. Tests must never use the real home or a running personal server.

## Limits and open questions

### Baseline limits

- One currency per book. There is no receipt exchange-rate model.
- No OCR, receipt parser, model call, inventory, shopping list, or equipment subsystem is implemented here.
- A receipt can exist without a photo or payment, but an unpaid cash purchase cannot reach finished without a ledger transaction.
- The schema and manual split planner support many-to-many payments. Automatic application deliberately does not. Historical UI support is narrower than the operation model.
- Matching guesses from amounts, dates, and payees. It does not establish proof of identity. Tip suggestions are not automatically linked.
- Category and product inheritance use current trees. Editing a tree can change historical computed categorization and applied status.
- Computed applied status is not an audit trail, ownership marker, or stored consent to overwrite.
- Manual application may use unbalanced or partially paid receipt data. Auto-apply has stricter readiness conditions.
- Receipt-based spending is not necessarily ledger spending. It can include unmatched receipts and raw printed totals even when itemization is incomplete.
- Price history excludes receipt-wide adjustments from unit prices. Spending reports include them through allocation. Store means are arithmetic means of observed line prices, not quantity-weighted quotes.
- Some read paths load all receipts or lines to compute status before filtering and paging. The implementation assumes a personal book, not a large multi-user receipt service.
- Database transactions cannot atomically roll back arbitrary filesystem writes. Photo rollback, trash, and missing-file recovery deserve explicit acceptance checks in any rewrite.

### Decisions still deferred

The freeze does not approve the current schemas, matching constants, stage model, automatic application policy, operation names, or screen layouts as future requirements. Whether to preserve each behavior, migrate it, or omit it remains a product and compatibility decision. In particular, the return design still needs to settle data ownership across a possible plugin boundary, access to hidden legacy data, automation consent, evidence portability, supported external interfaces, and the smallest purchase workflow worth maintaining. [Purchases needs](purchases-needs.md) records the confirmed intent separately.
