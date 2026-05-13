// Playwright E2E — browser-side useChat round-trip for the walking skeleton.
//
// Why this test exists (per design/wave-decisions.md §6 contract-test annotation
// and Application Architecture 13): the chat surface depends on the
// Mastra ↔ AI SDK Data Stream Protocol bridge being correct. The InMemory mock
// catches every server-side bug; this Playwright spec catches the *wire-format*
// bugs (ENRICH-DELIVER-01) — useChat tokens must render as text bubbles, tool
// calls must surface as cards, the stream must close cleanly.
//
// RED-ready: this will not run until DELIVER step 0 scaffolds apps/web,
// apps/api, and a `pnpm dev` script that boots both with the AI SDK
// MockLanguageModelV1 wired in (env var NETEA_USE_MOCK_LLM=1).

import { expect, test } from "@playwright/test";

const APP_URL = process.env.NETEA_E2E_URL ?? "http://localhost:5173";

test.describe("Walking skeleton — useChat browser round-trip", () => {
  test("Given the seed corpus contains one cardiology question and the LLM is mocked, when Priya types a clinical query and presses Send, then the agent's reply renders the question card within 4 seconds", async ({ page }) => {
    await page.goto(APP_URL);

    await expect(page.getByText(/welcome|ask about/i)).toBeVisible();

    const input = page.getByPlaceholder(/ask about a topic|clinical scenario/i);
    await input.fill("shortness of breath with leg swelling");

    const sendStartedAt = Date.now();
    await page.getByRole("button", { name: /send/i }).click();

    // First token visible within 2 seconds
    await expect(page.getByText(/cardiology: patient symptoms/i)).toBeVisible({ timeout: 2000 });

    // Full referenced excerpt rendered within 4 seconds
    await expect(page.getByText(/68-year-old man presents with/i)).toBeVisible({ timeout: 4000 });

    const elapsed = Date.now() - sendStartedAt;
    expect(elapsed).toBeLessThan(4000);

    // No invented titles: only the seed title appears in result-card slots
    const titles = await page.getByTestId("result-card-title").allTextContents();
    for (const t of titles) {
      expect(t).toContain("Cardiology: Patient Symptoms");
    }
  });
});
