import { Button } from "@reeve/ui/components/button";
import {
  BotIcon,
  ChartPieIcon,
  ReceiptIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  TerminalIcon,
  TrendingUpIcon,
} from "lucide-react";
import { useState } from "react";
import { AssistantApp, type AssistantChat } from "@landing/components/assistant-app";
import { Faq, type FaqItem } from "@landing/components/faq";
import { FeatureBento } from "@landing/components/feature-bento";
import { MegaFooter, type FooterTheme } from "@landing/components/mega-footer";
import { StatsBand } from "@landing/components/stats-band";
import { VersusTable } from "@landing/components/versus-table";
import { Screens } from "./screens.tsx";

const REPO = "https://github.com/cagdotin/reeve";
const DOWNLOAD = `${REPO}/releases`;

const NAV = [
  { label: "Steward", href: "#steward" },
  { label: "Features", href: "#features" },
  { label: "Compare", href: "#compare" },
  { label: "FAQ", href: "#faq" },
] as const;

const primary =
  "h-12 rounded-xl px-6 text-base sm:h-12 sm:text-base shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_1px_2px_rgb(0_0_0/0.05)]";

const STEWARD_CHATS: Array<AssistantChat> = [
  {
    id: "receipt",
    title: "Receipt from Corner Grocer",
    group: "Today",
    messages: [
      {
        id: "r1",
        role: "user",
        content: "Add this one.",
        attachments: [{ name: "corner-grocer.jpg", size: "1.2 MB" }],
      },
      {
        id: "r2",
        role: "assistant",
        content:
          "Added **Corner Grocer, $64.20** on Nov 2, split into **Food $52.70** and **General $11.50**.\n\nYour bank had already synced the card payment this morning, so I matched it instead of adding a second one. Undo it any time.",
      },
    ],
  },
  {
    id: "december",
    title: "Budget December",
    group: "Today",
    messages: [
      {
        id: "d1",
        role: "user",
        content: "Fund December like November, but move $100 from Fun to Rainy Day Savings.",
      },
      {
        id: "d2",
        role: "assistant",
        content:
          "Done. December has **$3,450** budgeted:\n\n1. Bills $1,450, Food $450, Dining out $180, Transport $120, General $200\n2. Fun **$50** (was $150)\n3. Rainy Day Savings **$1,000** (was $900)\n\nNothing is left to budget.",
      },
    ],
  },
  {
    id: "dining",
    title: "Dining out this year",
    group: "Yesterday",
    messages: [
      { id: "e1", role: "user", content: "How much have we spent eating out since June?" },
      {
        id: "e2",
        role: "assistant",
        content:
          "**$465.92** from June to November, about **$78 a month**, all at Noodle House. You budget $180 a month for it, so the category has been carrying money forward.",
      },
    ],
  },
];

const stewardReply = (prompt: string) =>
  `I'd read your ledger for "${prompt.slice(0, 60)}", make the change as one undoable step and tell you exactly what moved.\n\nThis chat is a preview. In reeve, the Steward runs the same operations as the app on your own book.`;

const AGENT_POINTS = [
  {
    icon: BotIcon,
    title: "Bring your own agent",
    text: "Claude, ChatGPT, Grok or a bot of your own connect over MCP or the reeve CLI, with the same powers as the app.",
  },
  {
    icon: ReceiptIcon,
    title: "Send it a receipt",
    text: "Forward a photo or a screenshot. Your agent reads it and records the purchase, split across categories.",
  },
  {
    icon: RotateCcwIcon,
    title: "Every change can be undone",
    text: "Whatever an agent writes is one step in the history. One click puts it back.",
  },
] as const;

const FAQ: Array<FaqItem> = [
  {
    id: "free",
    category: "reeve",
    question: "Is reeve really free?",
    answer:
      "Yes. reeve is open source under the MIT license. There is no subscription, no trial and no account, and nothing about you is sold, because nothing about you reaches us.",
  },
  {
    id: "ai",
    category: "Agents",
    question: "What does AI-native mean here?",
    answer:
      "Everything you can do in the app, an agent can do too. Each operation is defined once and served to the app, an HTTP API, MCP tools and the reeve CLI. The Steward is the agent built into reeve; any other agent gets the same tools.",
  },
  {
    id: "agents",
    category: "Agents",
    question: "Which agents can I connect?",
    answer:
      "Any MCP client, such as Claude, connects to reeve's MCP server. Agents that run commands, like Claude Code or a Grok or Telegram bot on your machine, use the reeve CLI, which ships with a skill that teaches them how.",
  },
  {
    id: "receipts",
    category: "Agents",
    question: "Can my agent add receipts?",
    answer:
      "Send your agent a photo or a screenshot of a receipt and it records the purchase, with the total split across your categories. The receipts extension goes further and keeps every line item, so you can see what you pay for milk over time.",
  },
  {
    id: "data",
    category: "Your data",
    question: "Where is my money kept?",
    answer:
      "In one SQLite file on your computer. reeve has no cloud and no sign-in. If you connect a cloud AI, it sees what it reads through reeve; use a local model if you would rather nothing leaves your machine.",
  },
  {
    id: "banks",
    category: "Your data",
    question: "Does it sync with my bank?",
    answer:
      "Yes, read-only through Enable Banking for European banks, with an application you register yourself, so your credentials stay with you. Any bank's CSV, OFX, QFX, QIF or CAMT file imports too, and reeve skips what it already has.",
  },
  {
    id: "switch",
    category: "Your data",
    question: "I use YNAB or Actual. Can I switch?",
    answer:
      "Export your transactions from either as CSV or OFX and import them; reeve skips duplicates. Envelope budgeting works the way Actual does it, so your habits carry over.",
  },
  {
    id: "ledger",
    category: "reeve",
    question: "Why a double-entry ledger?",
    answer:
      "Every transaction is postings that add up to zero, and categories are accounts inside the ledger. Money can't go missing between your accounts and your budget, and the budget is computed from the ledger rather than stored beside it.",
  },
];

function setTheme(theme: FooterTheme) {
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function Nav() {
  return (
    <header className="fixed inset-x-2 top-2 z-30 sm:inset-x-4">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between rounded-[18px] bg-neutral-100/72 px-3 ps-6 backdrop-blur-xl dark:bg-neutral-900/72">
        <a className="flex items-center" href="/">
          <img alt="reeve" className="h-6 dark:hidden" src="/logo-light.svg" />
          <img alt="reeve" className="hidden h-6 dark:block" src="/logo-dark.svg" />
        </a>
        <nav className="flex items-center gap-1 text-[0.9375rem]">
          {NAV.map((item) => (
            <a
              className="rounded-lg px-3 py-2 hover:bg-foreground/5 max-md:hidden"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
          <a className="rounded-lg px-3 py-2 hover:bg-foreground/5 max-sm:hidden" href={REPO}>
            GitHub
          </a>
          <Button
            className="ms-2 h-10 rounded-xl px-4 sm:h-10"
            render={<a aria-label="Download" href={DOWNLOAD} />}
          >
            Download
          </Button>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="flex flex-col items-center px-4 pt-40 text-center sm:px-8 sm:pt-48">
      <a
        className="flex items-center gap-2 rounded-full border bg-background py-1 ps-1 pe-3 text-sm shadow-xs/5 hover:bg-muted"
        href="#steward"
      >
        <span className="rounded-full bg-[#0B3A2E] px-2 py-0.5 font-medium text-white text-xs">
          New
        </span>
        Meet the Steward, the agent inside your budget
      </a>
      <h1 className="mt-8 max-w-5xl text-balance font-bold text-[clamp(3rem,9vw,6rem)] leading-[0.95] tracking-[-0.055em]">
        The budget that keeps itself.
      </h1>
      <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground sm:text-xl">
        reeve is a free, AI-native budgeting app on a real double-entry ledger. Your bank syncs in,
        rules sort it, and your agents do the rest, all on your own computer.
      </p>
      <div className="mt-10 flex w-full max-w-md flex-col gap-3 sm:flex-row">
        <Button
          className={`${primary} flex-1`}
          render={<a aria-label="Download for macOS" href={DOWNLOAD} />}
        >
          Download for macOS
        </Button>
        <Button
          className={`${primary} flex-1`}
          render={<a aria-label="See it work" href="#steward" />}
          variant="outline"
        >
          See it work
        </Button>
      </div>
      <p className="mt-4 text-muted-foreground text-sm">
        <span className="text-foreground">Free and open source.</span> No account, no cloud, no
        subscription.
      </p>
    </section>
  );
}

function Steward() {
  return (
    <section className="mx-auto w-full max-w-[1328px] scroll-mt-24 px-4 sm:px-8" id="steward">
      <header className="grid gap-6 md:grid-cols-2 md:items-end">
        <div>
          <p className="inline-flex w-fit rounded-full bg-muted px-3 py-1 font-medium text-foreground text-sm">
            AI-native
          </p>
          <h2 className="mt-5 text-balance font-bold font-heading text-4xl leading-[1.04] tracking-[-0.045em] sm:text-[3.5rem]">
            An accountant that lives in your books.
          </h2>
        </div>
        <p className="max-w-lg text-pretty text-lg text-muted-foreground md:justify-self-end">
          Ask the Steward what you spent, have it budget next month, or hand it a receipt. It works
          on the same ledger you see, and tells you exactly what it changed.
        </p>
      </header>
      <AssistantApp
        chats={STEWARD_CHATS}
        className="mt-12 h-[600px] max-w-none rounded-3xl"
        defaultChatId="receipt"
        greeting="What should I take care of?"
        productName="Steward"
        reply={stewardReply}
        suggestions={[
          {
            icon: SearchIcon,
            title: "Categorize this week",
            prompt: "Categorize everything from this week",
          },
          {
            icon: ChartPieIcon,
            title: "Why is Food over?",
            prompt: "Why is Food over budget this month?",
          },
          {
            icon: TrendingUpIcon,
            title: "Forecast to March",
            prompt: "Where will Everyday Checking be in March?",
          },
          {
            icon: ShieldCheckIcon,
            title: "Find subscriptions",
            prompt: "Find subscriptions I might have forgotten",
          },
        ]}
        user={{ name: "You", initials: "Y" }}
      />
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {AGENT_POINTS.map(({ icon: Icon, title, text }) => (
          <div className="rounded-3xl border bg-card p-6" key={title}>
            <Icon className="size-5 text-muted-foreground" />
            <h3 className="mt-4 font-semibold text-lg tracking-tight">{title}</h3>
            <p className="mt-1 text-pretty text-muted-foreground text-sm leading-relaxed">{text}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 overflow-x-auto rounded-2xl bg-muted px-5 py-4 font-mono text-sm">
        <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="whitespace-nowrap">
          <span className="text-muted-foreground">$</span> reeve budget show
          <span className="ms-6 text-muted-foreground">
            2026-11 To Budget 0.00 (income 3,450.00, budgeted 3,450.00, held 0.00)
          </span>
        </span>
      </div>
    </section>
  );
}

export function App() {
  const [theme, onThemeChange] = useState<FooterTheme>("system");
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Nav />
      <main className="flex flex-col gap-32 pb-32 sm:gap-44">
        <div>
          <Hero />
          <Screens />
        </div>
        <Steward />
        <div className="scroll-mt-24" id="features">
          <FeatureBento
            className="px-4 sm:px-8"
            description="Bank sync, rules, schedules, targets and reports, in an app that does the busywork for you."
            eyebrow="Features"
            features={[
              {
                title: "Dashboards you arrange",
                description:
                  "Build as many dashboards as you like from widgets: net worth, cash flow, spending, Sankey, forecasts and your own custom reports.",
                demo: "insights",
                span: 4,
              },
              {
                title: "Bank sync that sorts itself",
                description:
                  "New transactions arrive from your bank and rules rename payees and set categories before you look.",
                demo: "automation",
                span: 2,
              },
              {
                title: "Fourteen kinds of report",
                description:
                  "From net worth and cash flow to balance forecasts, crossover point and Monte Carlo.",
                demo: "search",
                span: 2,
              },
              {
                title: "A CLI for you and your agents",
                description:
                  "Every operation is a command, so scripts and agents can keep your books.",
                demo: "shortcuts",
                span: 2,
              },
              {
                title: "Undo anything",
                description:
                  "Every change is one step back, whether you made it, a rule did, or an agent did.",
                demo: "history",
                span: 2,
              },
            ]}
            title="Everything a budget needs, then some."
          />
        </div>
        <StatsBand
          className="px-4 sm:px-8"
          description="Every one of them is open to you, your scripts and your agents."
          eyebrow="Under the hood"
          stats={[
            {
              value: 148,
              label: "Operations",
              caption: "One catalog behind the app, API, MCP and CLI",
            },
            {
              value: 14,
              label: "Report types",
              caption: "Each one can be a widget on a dashboard",
            },
            { value: 3, label: "Category levels", caption: "Categories nest inside categories" },
            { value: 0, prefix: "$", label: "Price", caption: "MIT licensed, no subscription" },
          ]}
          title="A real ledger, built for agents."
        />
        <div className="scroll-mt-24" id="compare">
          <VersusTable
            className="px-4 sm:px-8"
            description="The envelope method you know, on a double-entry ledger, with agents built in. No subscription and no server."
            eyebrow="Compare"
            groups={[
              {
                name: "Budgeting",
                rows: [
                  {
                    label: "Envelope budgeting",
                    values: { reeve: true, ynab: true, actual: true },
                  },
                  { label: "Tracking budgets", values: { reeve: true, ynab: false, actual: true } },
                  { label: "Budget targets", values: { reeve: true, ynab: true, actual: true } },
                  {
                    label: "Categories inside categories",
                    values: { reeve: "3 levels", ynab: false, actual: false },
                  },
                  {
                    label: "Dashboards you arrange",
                    values: { reeve: true, ynab: false, actual: true },
                  },
                  {
                    label: "Double-entry ledger",
                    values: { reeve: true, ynab: false, actual: false },
                  },
                ],
              },
              {
                name: "AI and automation",
                rows: [
                  {
                    label: "Built-in agent",
                    values: { reeve: "Steward", ynab: false, actual: false },
                  },
                  {
                    label: "MCP for Claude and others",
                    values: { reeve: true, ynab: false, actual: false },
                  },
                  {
                    label: "Command-line tool",
                    values: { reeve: true, ynab: false, actual: true },
                  },
                  { label: "API", values: { reeve: true, ynab: true, actual: true } },
                ],
              },
              {
                name: "Your money",
                rows: [
                  {
                    label: "Books stay on your computer",
                    values: { reeve: true, ynab: false, actual: true },
                  },
                  {
                    label: "No account to create",
                    values: { reeve: true, ynab: false, actual: true },
                  },
                  {
                    label: "Bank sync",
                    values: { reeve: "Europe", ynab: "US, CA, UK, EU", actual: "Through a server" },
                  },
                  {
                    label: "Native phone apps",
                    values: { reeve: false, ynab: true, actual: false },
                  },
                  {
                    label: "Price",
                    values: { reeve: "Free", ynab: "$109 a year", actual: "Free" },
                  },
                ],
              },
            ]}
            them={[
              { id: "ynab", name: "YNAB" },
              { id: "actual", name: "Actual" },
            ]}
            title="Why switch to reeve"
            us={{ id: "reeve", name: "reeve" }}
          />
        </div>
        <div className="scroll-mt-24" id="faq">
          <Faq
            categories={["reeve", "Agents", "Your data"]}
            className="px-4 sm:px-8"
            contact={{
              title: "Something else?",
              text: "Open an issue or a discussion on GitHub.",
              label: "Open GitHub",
              href: REPO,
            }}
            description="Everything about money, agents and where your data lives."
            items={FAQ}
          />
        </div>
        <section className="mx-auto w-full max-w-[1328px] px-4 sm:px-8">
          <div className="relative overflow-hidden rounded-[28px] bg-[#0B3A2E] px-6 py-20 text-center text-white sm:py-28">
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.14)_1px,transparent_1.2px)] bg-size-[6px_6px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
            />
            <h2 className="relative mx-auto max-w-3xl text-balance font-bold text-4xl leading-[1.04] tracking-[-0.045em] sm:text-6xl">
              Hand over the bookkeeping. Keep the books.
            </h2>
            <p className="relative mx-auto mt-5 max-w-xl text-lg text-white/70">
              Free, local-first and ready for your agents.
            </p>
            <div className="relative mt-10 flex justify-center">
              <Button
                className={`${primary} border-white bg-white text-[#0B3A2E] hover:bg-white/90`}
                render={<a aria-label="Download reeve" href={DOWNLOAD} />}
              >
                Download reeve
              </Button>
            </div>
          </div>
        </section>
      </main>
      <MegaFooter
        brand={{
          name: "reeve",
          tagline: "The AI-native, local-first budget.",
          href: "/",
          mark: <img alt="" className="size-6" src="/favicon.svg" />,
        }}
        className="px-4 sm:px-8"
        columns={[
          {
            title: "Product",
            links: [
              { label: "Steward", href: "#steward" },
              { label: "Features", href: "#features" },
              { label: "Compare", href: "#compare" },
              { label: "FAQ", href: "#faq" },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "Download", href: DOWNLOAD },
              { label: "Source", href: REPO },
              { label: "License", href: `${REPO}/blob/master/LICENSE`, badge: "MIT" },
            ],
          },
        ]}
        copyright="© 2026 reeve contributors. MIT licensed."
        onThemeChange={(next) => {
          onThemeChange(next);
          setTheme(next);
        }}
        theme={theme}
      />
    </div>
  );
}
