import type { BrowserContext, Page, Route } from "@playwright/test";
import type { LegacyAISettingsPatch, AIConnectionResponse } from "../../src/shared/types/aiConnectionMessages";
declare const chrome: { runtime: { sendMessage: (message: unknown) => Promise<AIConnectionResponse> } };

/** Configure AI through the real background writer, after Popup initialization. */
export async function seedAIConnection(page: Page, settings: LegacyAISettingsPatch): Promise<void> {
  const response = await page.evaluate(async (patch) => {
    return await chrome.runtime.sendMessage({ type: "AI_CONNECTION_APPLY_LEGACY_SETTINGS", settings: patch }) as AIConnectionResponse;
  }, settings);
  if (!response?.ok) throw new Error(`AI fixture configuration failed: ${response?.code ?? "NO_RESPONSE"}`);
}

/** Preserve canonical model/transport authority while serving fixture responses locally. */
const fixtureOrigins = new WeakMap<BrowserContext, string>();
export async function routeCanonicalOpenAIToFixture(context: BrowserContext, origin: string): Promise<void> {
  fixtureOrigins.set(context, origin);
}

/** Install before per-test held-response routes, so those retain priority. */
export async function installCanonicalOpenAIFixtureRoute(context: BrowserContext): Promise<void> {
  await context.route("https://api.openai.com/v1/chat/completions", async route => {
    const origin = fixtureOrigins.get(context);
    if (!origin) { await route.abort("blockedbyclient"); return; }
    const response = await route.fetch({ url: `${origin}/api/v1/chat/completions`, maxRedirects: 0 });
    if (response.ok()) await fulfillOpenAIJSON(route, await response.json() as { choices: Array<{ message: { content: string } }> });
    else await route.fulfill({ response });
  });
}

/** Canonical adapters may stream; fixtures preserve the same response meaning. */
export async function fulfillOpenAIJSON(route: Route, body: { choices: Array<{ message: { content: string } }> }): Promise<void> {
  if (route.request().postDataJSON()?.stream === true) {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content: body.choices[0].message.content } }] })}\n\ndata: [DONE]\n\n` });
  } else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}
