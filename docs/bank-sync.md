# Bank sync

reeve fetches booked transactions from your banks through [Enable Banking](https://enablebanking.com),
read only. You register your own application with them, free, and link your own accounts to it.
No money can move, and nothing passes through a server of reeve's. The design is
[bank rules](rules/bank.md).

## Set up

1. Sign in at the [control panel](https://enablebanking.com/cp/applications) and register an
   application for **production**. Enter `https://localhost/reeve` as the redirect address. The form
   may refuse it, in which case use any `https:` address you control. The panel downloads a `.pem`
   private key.
2. In the panel, link your own accounts to the application (restricted mode).
3. In reeve, open **Settings → Banks**. Give the application ID, the `.pem` file and the same
   redirect address. reeve checks them against the provider and keeps the key in
   `<home>/bank/`, readable only by you.

On the command line, `reeve bank credentials --application-id <id> --key-path <file> --redirect-url <url>`.

## Link a bank

1. **Add a bank…**, choose the country and the bank. For Erste with an AT IBAN, choose Austria and the
   Erste entry. Look for Revolut under Austria first, then under the country of its IBAN (untested).
2. **Open** the bank, sign in and approve. It sends you to the redirect address. That page may show a
   connection error. This is fine: copy the whole address and paste it in reeve.
3. For each bank account, choose a new account, an existing one, or leave it out. Take care with
   **First day to take** on an account you already filled from files: leave it empty, and fetching
   starts the day after the account's latest transaction.

The first fetch runs at once. A bank usually gives its longest history only in the first hour after
you approve.

## Day to day

- **Fetch from bank** in an account's toolbar fetches it. **Fetch by itself** in Settings → Banks
  fetches every 6 hours while reeve runs.
- Your rules run on what arrives, and existing transactions are matched, as with a bank file. A
  rule can also match the other party's account number: **Counterparty account** in the rule
  editor, and the Rules page suggests such rules from what your banks sent.
- A card payment without a name gets its payee from the bank's text, without the day, the minute
  and the terminal number. The full text stays in the notes. Rename or merge a payee with **Send
  later imports** on, and the shop's later lines land there too. The Payees page suggests payees
  that look like one. How this works: [Bank payees](bank-payees.md).
- reeve keeps each line as the bank sent it, account numbers included, in your book on this
  computer only.
- If you delete a line, or undo a fetch, it stays out of later fetches. **Left out…** in Settings →
  Banks brings it back from the line the bank sent; a line fetched before reeve kept lines comes
  back with the next fetch that covers it.
- Deleting a transaction from the bank asks first and says how far the account will be off the
  bank. When it looks like one you entered by hand (same account and amount, within 7 days),
  **Merge** keeps yours with the bank's line. A line in the wrong place wants another category or a
  transfer instead. **Delete anyway** is there for a bank's own mistake.
- Two sides of one movement that arrived apart: select both under **All accounts**, then **Make
  transfer**, or write a rule that sets **Transfer to**.
- A warning that the balance is off means your cleared balance differs from what the bank says.
- A consent ends after the bank's maximum, about 180 days. **Renew…** appears two weeks before.
  Your accounts stay linked.

## Try it without touching your real budget

The first run of this version upgrades a book, and older versions cannot read it afterward. Try it
on a scratch home first:

```sh
export REEVE_HOME=$(mktemp -d) REEVE_PORT=4700
pnpm --filter @reeve/server dev
# in a second terminal, from apps/web
REEVE_API_PORT=4700 npx vite --port 5700 --strictPort
```

Then open `http://localhost:5700/settings/banks`. Do not use `pnpm dev` for this: it attaches to the
server of your real home.

## What only a real account can settle

The tests run against a stand-in that follows the provider's documentation.

1. Does the registration form accept `https://localhost/reeve`?
2. Which Erste and Revolut entries does the list show, and how long a consent do they give?
3. How far back does the first fetch reach, and how do Revolut's pockets appear?
4. After approving again, do accounts stay linked? This rests on `identification_hash`.
5. What does a fifth fetch in one day answer?
6. Over a week, do `entry_reference` values stay the same at Erste? The design rests on this most.
   A changing reference shows as the same transaction arriving twice.
