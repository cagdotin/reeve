import type { Problem } from "./backend.ts";

/** Where the problem page's buttons point; the window catches the navigation and answers. */
export const ANSWERS = {
  retry: "https://reeve.invalid/try-again",
  quit: "https://reeve.invalid/quit",
} as const;

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** A page that tells the person why the app has no server, with Try Again and Quit. */
export const problemPage = (problem: Problem): string => {
  const [lead = "", ...log] = problem.detail.split("\n");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>reeve</title>
<style>
  :root { color-scheme: light dark; --bg: #faf9f6; --fg: #1f1e1b; --muted: #66635d; --card: #fdfcfa; --line: #dfddd7; --accent: #2a2926; --on-accent: #faf9f6; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1d1e20; --fg: #e8e8e6; --muted: #a3a4a6; --card: #232427; --line: #38393c; --accent: #e8e8e6; --on-accent: #1d1e20; } }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, sans-serif; }
  .drag { position: fixed; inset: 0 0 auto 0; height: 40px; -webkit-app-region: drag; }
  main { max-width: 560px; margin: 0 auto; padding: 18vh 24px 24px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: var(--muted); }
  pre { margin: 0 0 16px; padding: 12px; max-height: 40vh; overflow: auto; background: var(--card); border: 1px solid var(--line); border-radius: 8px; font: 12px/1.5 ui-monospace, monospace; white-space: pre-wrap; }
  nav { display: flex; gap: 8px; }
  a { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); color: var(--fg); text-decoration: none; }
  a.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
</style></head>
<body><div class="drag"></div><main>
  <h1>${escape(problem.title)}</h1>
  <p>${escape(lead)}</p>
  ${log.length > 0 ? `<pre>${escape(log.join("\n"))}</pre>` : ""}
  <nav><a class="primary" href="${ANSWERS.retry}">Try Again</a><a href="${ANSWERS.quit}">Quit</a></nav>
</main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};
