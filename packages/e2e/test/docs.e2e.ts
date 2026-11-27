import { expectCount, expectEventually, expectVisible, test } from "../src/fixtures.ts";

test("the footer opens the docs, whose links stay in the app, and leads back", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/reports`);
  await expectVisible(page.getByRole("heading", { name: "All reports", level: 1 }));

  const rail = page.getByRole("navigation", { name: "Pages" });
  await page.getByRole("contentinfo").getByRole("link", { name: "Docs", exact: true }).click();
  await expectVisible(page.getByRole("heading", { name: "reeve docs", level: 1 }));

  await page.getByRole("main").getByRole("link", { name: "The rules index" }).click();
  await expectVisible(page.getByRole("heading", { name: "Rules", level: 1 }));
  await page.getByRole("main").getByRole("link", { name: "docs/rules/scope.md" }).click();
  await expectVisible(page.getByRole("heading", { name: "Scope", level: 1 }));

  await page
    .getByRole("navigation", { name: "Documents" })
    .getByRole("link", { name: "Architecture" })
    .click();
  await expectVisible(page.getByRole("figure", { name: "Diagram" }).locator("svg"));

  await page.getByRole("button", { name: "Back to app" }).click();
  await page.waitForURL(`${app.url}/reports`);
  await expectVisible(rail.getByRole("link", { name: "Budget", exact: true }));
});

test("Docs has the same pane and title as Settings, and no back button", async ({ app }) => {
  const { page } = app;
  const measure = (name: string, label: string, title: string) =>
    page.evaluate(
      ([name, label, title]) => {
        const box = (element: Element | null | undefined) => {
          const { left, top, width } = element!.getBoundingClientRect();
          return { left, top, width };
        };
        const pane = document.querySelector(`nav[aria-label="${name}"]`)!;
        const heading = [...document.querySelectorAll("main :not(aside, aside *)")].find(
          (element) => element.childElementCount === 0 && element.textContent === title,
        );
        return {
          label: [...pane.querySelectorAll("h2")].some((title) => title.textContent === label),
          pane: box(pane.closest("aside")),
          firstLink: box(pane.querySelector("a")),
          title: box(heading),
        };
      },
      [name, label, title] as const,
    );
  const position = ({ left, top }: { left: number; top: number }) => ({ left, top });

  await page.goto(`${app.url}/settings/general`);
  await expectVisible(page.getByRole("navigation", { name: "Section" }));
  const settings = await measure("Section", "Settings", "General");

  await page.goto(`${app.url}/docs`);
  await expectVisible(page.getByRole("heading", { name: "reeve docs", level: 1 }));
  await expectEventually(
    async () => {
      const docs = await measure("Documents", "Docs", "reeve docs");
      return { ...docs, title: position(docs.title) };
    },
    { ...settings, title: position(settings.title) },
  );
  await expectEventually(() => page.getByRole("button", { name: "Back", exact: true }).count(), 0);
  await expectEventually(
    () =>
      page.evaluate(() => {
        const pane = document.querySelector("aside")!.getBoundingClientRect().right;
        return [...document.querySelectorAll('nav[aria-label="Documents"] a')].filter(
          (link) => link.getBoundingClientRect().right > pane,
        ).length;
      }),
    0,
  );
});

test("on a phone, Docs lists its documents in a sheet", async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.url}/budget`);

  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Docs", exact: true })
    .click();
  await expectVisible(page.getByRole("heading", { name: "reeve docs", level: 1 }));

  await page.getByRole("button", { name: "Contents" }).click();
  await page
    .getByRole("dialog", { name: "Documentation" })
    .getByRole("link", { name: /reeve brand/ })
    .click();
  await expectVisible(page.getByRole("heading", { name: "reeve brand", level: 1 }));
});

test("the brand page copies a color and offers the whole kit, file by file and as a zip", async ({
  app,
}) => {
  const { page } = app;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${app.url}/docs/brand`);
  await expectVisible(page.getByRole("heading", { name: "reeve brand", level: 1 }));
  await expectCount(page.getByRole("heading", { level: 1 }), 1);

  const forest = page.getByRole("button", { name: "Copy Forest #0B3A2E" });
  await forest.click();
  await expectVisible(forest.getByText("Copied"));
  await expectEventually(() => page.evaluate(() => navigator.clipboard.readText()), "#0B3A2E");

  await expectVisible(page.getByRole("link", { name: "Download logo-light.svg" }));
  await expectVisible(page.getByRole("link", { name: "Download icon-dark-1024.png" }));
  await expectVisible(page.getByRole("link", { name: "Download colors.css" }));

  await expectEventually(async () => {
    const zip = await page.request.get(`${app.url}/reeve-brand-kit.zip`);
    return (await zip.body()).subarray(0, 2).toString();
  }, "PK");
});
