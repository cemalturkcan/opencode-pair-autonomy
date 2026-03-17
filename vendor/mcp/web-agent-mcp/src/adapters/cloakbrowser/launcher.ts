import path from "node:path";
import type { BrowserContext, Frame, Locator, Page } from "playwright-core";
import { launchContext, launchPersistentContext } from "cloakbrowser";
import type { WebAgentEnv } from "../../config/env.js";
import { createId } from "../../utils/ids.js";
import { elapsedMs, nowIso } from "../../utils/time.js";
import type {
  AdapterA11yResult,
  AdapterAuthStateResult,
  AdapterConsoleEntry,
  AdapterDomResult,
  AdapterElementBox,
  AdapterEvaluateResult,
  AdapterNetworkEntry,
  AdapterNavigationResult,
  AdapterPageStateResult,
  AdapterScreenshotResult,
  AdapterSessionCreateInput,
  AdapterSessionHandle,
  AdapterTextResult,
  AdapterWaitForNetworkResult,
  CloakBrowserAdapter,
  WaitUntilState,
} from "./adapter.js";
import {
  classifyAuthStateSnapshot,
  normalizeAuthText,
  type AuthFrameInspection,
} from "./auth-heuristics.js";

function truncateText(text: string, maxChars = 12000) {
  if (text.length <= maxChars) {
    return { content: text, truncated: false };
  }

  return {
    content: text.slice(0, maxChars),
    truncated: true,
  };
}

function pushLimited<T>(items: T[], value: T, maxSize = 200) {
  items.push(value);
  if (items.length > maxSize) {
    items.splice(0, items.length - maxSize);
  }
}

function normalizeWhitespace(text: string) {
  return normalizeAuthText(text);
}

function attachEventBuffers(
  page: AdapterSessionHandle["page"],
  consoleEntries: AdapterConsoleEntry[],
  networkEntries: AdapterNetworkEntry[],
) {
  page.on("console", (message) => {
    pushLimited(consoleEntries, {
      type: message.type(),
      text: message.text(),
      location: message.location(),
      timestamp: nowIso(),
    });
  });

  page.on("response", (response) => {
    const request = response.request();
    pushLimited(networkEntries, {
      url: response.url(),
      method: request.method(),
      status: response.status(),
      resourceType: request.resourceType(),
      outcome: "response",
      timestamp: nowIso(),
    });
  });

  page.on("requestfailed", (request) => {
    pushLimited(networkEntries, {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      outcome: "failed",
      failureText: request.failure()?.errorText,
      timestamp: nowIso(),
    });
  });
}

async function createPage(context: BrowserContext) {
  const existing = context.pages()[0];
  if (existing) {
    return existing;
  }
  return context.newPage();
}

type InspectableTarget = Page | Frame;

type DocumentInspection = {
  title?: string;
  text: string;
  truncated: boolean;
  dom: AdapterDomResult["summary"];
  inputs: AdapterPageStateResult["inputs"];
  buttons: AdapterPageStateResult["buttons"];
};

async function inspectDocument(
  target: InspectableTarget,
): Promise<DocumentInspection> {
  const snapshot = await target.evaluate(() => {
    const normalize = (value: string | null | undefined) =>
      value?.replace(/\s+/g, " ").trim() || undefined;
    const isVisible = (element: Element) => {
      const html = element as HTMLElement;
      return Boolean(
        html.offsetWidth || html.offsetHeight || html.getClientRects().length,
      );
    };
    const summarizeElement = (element: Element) => ({
      tag: element.tagName.toLowerCase(),
      type: (element as HTMLInputElement).type || undefined,
      id: element.id || undefined,
      name: element.getAttribute("name") || undefined,
      placeholder: element.getAttribute("placeholder") || undefined,
      text: normalize(element.textContent),
      autocomplete: element.getAttribute("autocomplete") || undefined,
      visible: isVisible(element),
    });

    const text = (document.body?.innerText ?? "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((node) => normalize(node.textContent))
      .filter((value): value is string => Boolean(value))
      .slice(0, 20);

    return {
      title: document.title || undefined,
      text,
      dom: {
        headings,
        links: document.querySelectorAll("a[href]").length,
        buttons: document.querySelectorAll("button").length,
        forms: document.querySelectorAll("form").length,
        inputs: document.querySelectorAll("input, textarea, select").length,
      },
      inputs: Array.from(document.querySelectorAll("input, textarea, select"))
        .slice(0, 20)
        .map(summarizeElement),
      buttons: Array.from(document.querySelectorAll("button, [role='button']"))
        .slice(0, 20)
        .map(summarizeElement),
    };
  });

  const truncated = truncateText(snapshot.text, 4000);

  return {
    title: snapshot.title,
    text: truncated.content,
    truncated: truncated.truncated,
    dom: snapshot.dom,
    inputs: snapshot.inputs,
    buttons: snapshot.buttons,
  };
}

async function inspectFrames(page: Page) {
  const frames = page.frames().filter((frame) => frame !== page.mainFrame());
  const summaries = await Promise.all(
    frames.map(async (frame: Frame, index) => {
      try {
        const snapshot = await inspectDocument(frame);
        return {
          index,
          name: frame.name() || undefined,
          url: frame.url(),
          title: snapshot.title,
          text_preview: snapshot.text,
          truncated: snapshot.truncated,
          input_count: snapshot.inputs.length,
          button_count: snapshot.buttons.length,
        };
      } catch {
        return {
          index,
          name: frame.name() || undefined,
          url: frame.url(),
          title: undefined,
          text_preview: "",
          truncated: false,
          input_count: 0,
          button_count: 0,
        };
      }
    }),
  );

  return summaries;
}

async function inspectAuthFrames(page: Page): Promise<AuthFrameInspection[]> {
  const frames = page.frames().filter((frame) => frame !== page.mainFrame());

  return Promise.all(
    frames.map(async (frame: Frame, index) => {
      try {
        const snapshot = await inspectDocument(frame);
        return {
          index,
          name: frame.name() || undefined,
          url: frame.url(),
          title: snapshot.title,
          text: snapshot.text,
          inputs: snapshot.inputs,
          buttons: snapshot.buttons,
        };
      } catch {
        return {
          index,
          name: frame.name() || undefined,
          url: frame.url(),
          title: undefined,
          text: "",
          inputs: [],
          buttons: [],
        };
      }
    }),
  );
}

function matchNetworkEntry(
  entry: AdapterNetworkEntry,
  input: {
    urlPattern: string;
    useRegex: boolean;
    status?: number;
    outcome?: AdapterNetworkEntry["outcome"];
  },
) {
  const urlMatches = input.useRegex
    ? new RegExp(input.urlPattern).test(entry.url)
    : entry.url.includes(input.urlPattern);

  return (
    urlMatches &&
    (input.status === undefined || entry.status === input.status) &&
    (input.outcome === undefined || entry.outcome === input.outcome)
  );
}

async function getEditableMeta(locator: ReturnType<Page["locator"]>) {
  return locator.first().evaluate((element) => {
    const html = element as HTMLElement;
    const input = element as HTMLInputElement;
    return {
      tag: element.tagName.toLowerCase(),
      isEditable: html.isContentEditable || element.matches("input, textarea"),
      maxLength: typeof input.maxLength === "number" ? input.maxLength : -1,
      type: input.type || undefined,
    };
  });
}

function isFrameScopedSelector(selector: string) {
  return (
    selector.includes("internal:control=enter-frame") ||
    /(^|\s|>)iframe[.#\[:]/i.test(selector)
  );
}

async function readEditableValue(locator: Locator) {
  return locator.first().evaluate((element) => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      return element.value;
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      return element.innerText ?? element.textContent ?? "";
    }

    return undefined;
  });
}

async function setEditableValueWithDomFallback(
  locator: Locator,
  value: string,
) {
  await locator.first().evaluate((element, nextValue) => {
    const dispatch = (target: HTMLElement) => {
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.dispatchEvent(new Event("blur", { bubbles: true }));
    };

    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, nextValue);
      dispatch(element);
      return;
    }

    if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(element, nextValue);
      dispatch(element);
      return;
    }

    if (element instanceof HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(element, nextValue);
      dispatch(element);
      return;
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.textContent = nextValue;
      dispatch(element);
    }
  }, value);
}

function matchesFilledValue(
  actual: string | undefined,
  expected: string,
  appendedText?: string,
) {
  if (actual === expected) {
    return true;
  }

  if (actual && appendedText && actual.endsWith(appendedText)) {
    return true;
  }

  return normalizeWhitespace(actual ?? "") === normalizeWhitespace(expected);
}

type ClickStateSnapshot = {
  pageUrl: string;
  connected: boolean;
  tag?: string;
  type?: string;
  role?: string;
  disabled?: boolean;
  checked?: boolean;
  ariaPressed?: string;
  ariaExpanded?: string;
  text?: string;
  value?: string;
};

async function captureClickState(
  page: Page,
  locator: Locator,
): Promise<ClickStateSnapshot> {
  const elementState = await locator
    .first()
    .evaluate((element) => {
      const input = element as HTMLInputElement;
      return {
        connected: element.isConnected,
        tag: element.tagName.toLowerCase(),
        type: input.type || undefined,
        role: element.getAttribute("role") || undefined,
        disabled: "disabled" in input ? Boolean(input.disabled) : undefined,
        checked: "checked" in input ? Boolean(input.checked) : undefined,
        ariaPressed: element.getAttribute("aria-pressed") || undefined,
        ariaExpanded: element.getAttribute("aria-expanded") || undefined,
        text: normalizeAuthText(element.textContent ?? undefined) || undefined,
        value:
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? element.value
            : undefined,
      };
    })
    .catch(() => ({ connected: false }));

  return {
    pageUrl: page.url(),
    ...elementState,
  };
}

function didClickCauseProgress(
  before: ClickStateSnapshot,
  after: ClickStateSnapshot,
) {
  return (
    before.pageUrl !== after.pageUrl ||
    before.connected !== after.connected ||
    before.disabled !== after.disabled ||
    before.checked !== after.checked ||
    before.ariaPressed !== after.ariaPressed ||
    before.ariaExpanded !== after.ariaExpanded ||
    before.text !== after.text ||
    before.value !== after.value
  );
}

async function canUseDomClickFallback(locator: Locator) {
  return locator
    .first()
    .evaluate((element) => {
      const tag = element.tagName.toLowerCase();
      const type = (element as HTMLInputElement).type?.toLowerCase();
      const role = element.getAttribute("role")?.toLowerCase();

      return (
        tag === "button" ||
        tag === "a" ||
        role === "button" ||
        (tag === "input" &&
          ["button", "submit", "checkbox", "radio"].includes(type ?? ""))
      );
    })
    .catch(() => false);
}

async function triggerDomClick(locator: Locator) {
  await locator.first().evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.click();
    }
  });
}

async function resolveCodeTargets(page: Page, selector: string) {
  const direct = page.locator(selector);
  const directCount = await direct.count().catch(() => 0);

  if (directCount > 1) {
    return direct;
  }

  if (directCount === 1) {
    const meta = await getEditableMeta(direct);
    if (meta.isEditable) {
      return direct;
    }
  }

  const nested = page.locator(
    `${selector} input, ${selector} textarea, ${selector} [contenteditable='true']`,
  );
  const nestedCount = await nested.count().catch(() => 0);
  if (nestedCount > 0) {
    return nested;
  }

  return direct;
}

async function getElementCenter(
  page: AdapterSessionHandle["page"],
  selector: string,
) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    throw new Error(
      `Unable to resolve visible bounding box for selector: ${selector}`,
    );
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

class PlaywrightCloakBrowserAdapter implements CloakBrowserAdapter {
  constructor(private readonly env: WebAgentEnv) {}

  async createSession(
    input: AdapterSessionCreateInput,
  ): Promise<AdapterSessionHandle> {
    if (input.profileMode === "persistent") {
      const context = await launchPersistentContext({
        userDataDir:
          input.userDataDir ?? path.join(this.env.profilesDir, input.sessionId),
        headless: this.env.headless,
        locale: input.locale,
        timezone: input.timezoneId,
        humanize: input.humanize,
        args: input.launchArgs,
        viewport: input.viewport,
      });
      const page = await createPage(context);
      const consoleEntries: AdapterConsoleEntry[] = [];
      const networkEntries: AdapterNetworkEntry[] = [];
      attachEventBuffers(page, consoleEntries, networkEntries);
      return {
        contextId: createId("context"),
        pageId: createId("page"),
        context,
        page,
        profileMode: input.profileMode,
        locale: input.locale,
        viewport: input.viewport,
        consoleEntries,
        networkEntries,
      };
    }

    const context = await launchContext({
      headless: this.env.headless,
      locale: input.locale,
      timezone: input.timezoneId,
      humanize: input.humanize,
      args: input.launchArgs,
      viewport: input.viewport,
    });
    const page = await context.newPage();
    const consoleEntries: AdapterConsoleEntry[] = [];
    const networkEntries: AdapterNetworkEntry[] = [];
    attachEventBuffers(page, consoleEntries, networkEntries);
    return {
      contextId: createId("context"),
      pageId: createId("page"),
      context,
      page,
      profileMode: input.profileMode,
      locale: input.locale,
      viewport: input.viewport,
      consoleEntries,
      networkEntries,
    };
  }

  async closeSession(session: AdapterSessionHandle) {
    await session.context.close();
  }

  async navigate(
    session: AdapterSessionHandle,
    url: string,
    waitUntil: WaitUntilState,
  ): Promise<AdapterNavigationResult> {
    const startedAt = Date.now();
    await session.page.goto(url, { waitUntil });
    return {
      pageId: session.pageId,
      requestedUrl: url,
      finalUrl: session.page.url(),
      title: await session.page.title(),
      elapsedMs: elapsedMs(startedAt),
    };
  }

  async observeA11y(session: AdapterSessionHandle): Promise<AdapterA11yResult> {
    const tree = await session.page.evaluate(() => {
      const selector =
        "a, button, input, textarea, select, [role], [aria-label], [aria-labelledby], h1, h2, h3";
      const children = Array.from(document.querySelectorAll(selector))
        .slice(0, 200)
        .map((element) => ({
          role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
          name:
            element.getAttribute("aria-label") ??
            element.textContent?.replace(/\s+/g, " ").trim() ??
            undefined,
          tag: element.tagName.toLowerCase(),
          text: element.textContent?.replace(/\s+/g, " ").trim() ?? undefined,
        }));

      return {
        role: "document",
        name: document.title || undefined,
        children,
      };
    });
    return {
      url: session.page.url(),
      title: await session.page.title(),
      tree,
    };
  }

  async observeDom(session: AdapterSessionHandle): Promise<AdapterDomResult> {
    const summary = await session.page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .map((node) => node.textContent?.trim())
        .filter((value): value is string => Boolean(value))
        .slice(0, 20);

      return {
        headings,
        links: document.querySelectorAll("a[href]").length,
        buttons: document.querySelectorAll("button").length,
        forms: document.querySelectorAll("form").length,
        inputs: document.querySelectorAll("input, textarea, select").length,
      };
    });

    return {
      url: session.page.url(),
      title: await session.page.title(),
      summary,
    };
  }

  async observeText(
    session: AdapterSessionHandle,
    format: "text" | "markdown",
  ): Promise<AdapterTextResult> {
    const rawText = await session.page.evaluate(
      () => document.body?.innerText ?? "",
    );
    const normalizedText = rawText.replace(/\n{3,}/g, "\n\n").trim();
    const truncated = truncateText(normalizedText);

    return {
      url: session.page.url(),
      title: await session.page.title(),
      format,
      content: truncated.content,
      truncated: truncated.truncated,
    };
  }

  async inspectPageState(
    session: AdapterSessionHandle,
    recentNetworkLimit: number,
  ): Promise<AdapterPageStateResult> {
    const mainDocument = await inspectDocument(session.page);
    const frames = await inspectFrames(session.page);

    return {
      url: session.page.url(),
      title: await session.page.title(),
      text: mainDocument.text,
      truncated: mainDocument.truncated,
      dom: mainDocument.dom,
      inputs: mainDocument.inputs,
      buttons: mainDocument.buttons,
      frames,
      recentNetwork: session.networkEntries.slice(-recentNetworkLimit),
    };
  }

  async inspectAuthState(
    session: AdapterSessionHandle,
    recentNetworkLimit: number,
  ): Promise<AdapterAuthStateResult> {
    const mainDocument = await inspectDocument(session.page);
    const frameInspections = await inspectAuthFrames(session.page);
    const frames = frameInspections.map((frame) => ({
      index: frame.index,
      name: frame.name,
      url: frame.url,
      title: frame.title,
      text_preview: frame.text,
      truncated: false,
      input_count: frame.inputs.length,
      button_count: frame.buttons.length,
    }));
    const recentNetwork = session.networkEntries.slice(-recentNetworkLimit);
    const classified = classifyAuthStateSnapshot({
      pageUrl: session.page.url(),
      pageTitle: await session.page.title(),
      pageText: mainDocument.text,
      pageInputs: mainDocument.inputs,
      pageButtons: mainDocument.buttons,
      frames: frameInspections,
      recentNetwork,
    });

    return {
      url: session.page.url(),
      title: await session.page.title(),
      state: classified.state,
      confidence: classified.confidence,
      summary: classified.summary,
      evidence: classified.evidence,
      suggestedSelectors: classified.suggestedSelectors,
      frames,
      recentNetwork,
    };
  }

  async takeScreenshot(
    session: AdapterSessionHandle,
    mode: "viewport" | "full" | "element",
    format: "png" | "jpeg",
    quality?: number,
    selector?: string,
  ): Promise<AdapterScreenshotResult> {
    const screenshotOptions = {
      type: format,
      quality: format === "png" ? undefined : quality,
    } as const;

    if (mode === "element") {
      const locator = session.page.locator(selector ?? "").first();
      const box = await locator.boundingBox();
      const bytes = await locator.screenshot(screenshotOptions);
      return {
        url: session.page.url(),
        title: await session.page.title(),
        bytes,
        mimeType: format === "png" ? "image/png" : "image/jpeg",
        width: box?.width,
        height: box?.height,
      };
    }

    const bytes = await session.page.screenshot({
      fullPage: mode === "full",
      ...screenshotOptions,
    });
    const viewport = session.page.viewportSize() ?? session.viewport;
    return {
      url: session.page.url(),
      title: await session.page.title(),
      bytes,
      mimeType: format === "png" ? "image/png" : "image/jpeg",
      width: viewport.width,
      height: viewport.height,
    };
  }

  async observeBoxes(
    session: AdapterSessionHandle,
    selectors: string[],
  ): Promise<AdapterElementBox[]> {
    const boxes = await Promise.all(
      selectors.map(async (selector) => {
        const locator = session.page.locator(selector).first();
        const box = await locator.boundingBox();
        return {
          selector,
          x: box?.x ?? 0,
          y: box?.y ?? 0,
          width: box?.width ?? 0,
          height: box?.height ?? 0,
          visible: Boolean(box),
        };
      }),
    );

    return boxes;
  }

  async observeConsole(
    session: AdapterSessionHandle,
    limit: number,
  ): Promise<AdapterConsoleEntry[]> {
    return session.consoleEntries.slice(-limit);
  }

  async observeNetwork(
    session: AdapterSessionHandle,
    limit: number,
  ): Promise<AdapterNetworkEntry[]> {
    return session.networkEntries.slice(-limit);
  }

  async waitForNetwork(
    session: AdapterSessionHandle,
    input: {
      urlPattern: string;
      useRegex: boolean;
      status?: number;
      outcome?: AdapterNetworkEntry["outcome"];
      timeoutMs: number;
      pollIntervalMs: number;
    },
  ): Promise<AdapterWaitForNetworkResult> {
    const startedAt = Date.now();
    const existingMatch = [...session.networkEntries]
      .reverse()
      .find((entry) => matchNetworkEntry(entry, input));

    if (existingMatch) {
      return {
        url: session.page.url(),
        title: await session.page.title(),
        entry: existingMatch,
        elapsedMs: elapsedMs(startedAt),
      };
    }

    while (Date.now() - startedAt <= input.timeoutMs) {
      const match = [...session.networkEntries]
        .reverse()
        .find((entry) => matchNetworkEntry(entry, input));
      if (match) {
        return {
          url: session.page.url(),
          title: await session.page.title(),
          entry: match,
          elapsedMs: elapsedMs(startedAt),
        };
      }

      await session.page.waitForTimeout(input.pollIntervalMs);
    }

    throw new Error(
      `Timed out waiting for network entry matching ${input.urlPattern}`,
    );
  }

  async evaluateJs(
    session: AdapterSessionHandle,
    input: { expression: string; awaitPromise: boolean },
  ): Promise<AdapterEvaluateResult> {
    const value = await session.page.evaluate(
      async ({ expression, awaitPromise }) => {
        const seen = new WeakSet<object>();

        const normalize = (current: unknown): unknown => {
          if (current === null || current === undefined) {
            return current;
          }

          const currentType = typeof current;

          if (
            currentType === "string" ||
            currentType === "number" ||
            currentType === "boolean"
          ) {
            return current;
          }

          if (currentType === "bigint") {
            return { __type: "bigint", value: String(current) };
          }

          if (currentType === "function") {
            return { __type: "function" };
          }

          if (Array.isArray(current)) {
            return current.map((item) => normalize(item));
          }

          if (current instanceof Date) {
            return { __type: "date", value: current.toISOString() };
          }

          if (current instanceof Error) {
            return {
              __type: "error",
              name: current.name,
              message: current.message,
            };
          }

          if (current instanceof Element) {
            return {
              __type: "element",
              tag: current.tagName.toLowerCase(),
              id: current.id || undefined,
              text:
                current.textContent
                  ?.replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 500) || undefined,
            };
          }

          if (currentType === "object") {
            const objectValue = current as Record<string, unknown>;
            if (seen.has(objectValue)) {
              return { __type: "circular" };
            }
            seen.add(objectValue);

            const normalizedEntries = Object.entries(objectValue).map(
              ([key, value]) => [key, normalize(value)],
            );
            return Object.fromEntries(normalizedEntries);
          }

          return { __type: currentType };
        };

        const executed = (0, eval)(expression);
        const resolved = awaitPromise ? await executed : executed;
        return normalize(resolved);
      },
      {
        expression: input.expression,
        awaitPromise: input.awaitPromise,
      },
    );

    return {
      url: session.page.url(),
      title: await session.page.title(),
      value,
    };
  }

  async click(
    session: AdapterSessionHandle,
    input: {
      selector: string;
      button: "left" | "right" | "middle";
      clickCount: number;
      timeoutMs?: number;
    },
  ) {
    const locator = session.page.locator(input.selector).first();
    const before = await captureClickState(session.page, locator);
    let usedDomFallback = false;

    try {
      await locator.click({
        button: input.button,
        clickCount: input.clickCount,
        timeout: input.timeoutMs,
      });
    } catch (error) {
      if (
        !isFrameScopedSelector(input.selector) ||
        !(await canUseDomClickFallback(locator))
      ) {
        throw error;
      }

      await triggerDomClick(locator);
      usedDomFallback = true;
    }

    await session.page.waitForTimeout(200);
    const after = await captureClickState(session.page, locator);

    if (
      !usedDomFallback &&
      !didClickCauseProgress(before, after) &&
      isFrameScopedSelector(input.selector) &&
      (await canUseDomClickFallback(locator))
    ) {
      await triggerDomClick(locator);
      await session.page.waitForTimeout(200);
      usedDomFallback = true;
    }

    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: usedDomFallback
        ? `Clicked selector ${input.selector} with DOM fallback verification`
        : `Clicked selector ${input.selector}`,
    };
  }

  async fill(
    session: AdapterSessionHandle,
    input: {
      selector: string;
      value: string;
      clearFirst: boolean;
      timeoutMs?: number;
    },
  ) {
    const locator = session.page.locator(input.selector).first();
    const initialValue = await readEditableValue(locator).catch(
      () => undefined,
    );
    await locator.fill(
      input.clearFirst ? "" : await locator.inputValue().catch(() => ""),
      {
        timeout: input.timeoutMs,
      },
    );
    if (input.clearFirst) {
      await locator.fill(input.value, { timeout: input.timeoutMs });
    } else {
      await locator.pressSequentially(input.value, {
        timeout: input.timeoutMs,
      });
    }
    const expectedValue = input.clearFirst
      ? input.value
      : `${initialValue ?? ""}${input.value}`;
    let usedDomFallback = false;
    const currentValue = await readEditableValue(locator).catch(
      () => undefined,
    );

    if (
      !matchesFilledValue(
        currentValue,
        expectedValue,
        input.clearFirst ? undefined : input.value,
      )
    ) {
      await setEditableValueWithDomFallback(locator, expectedValue);
      const verifiedValue = await readEditableValue(locator).catch(
        () => undefined,
      );

      if (
        !matchesFilledValue(
          verifiedValue,
          expectedValue,
          input.clearFirst ? undefined : input.value,
        )
      ) {
        throw new Error(
          `Failed to persist value for selector ${input.selector}`,
        );
      }

      usedDomFallback = true;
    }

    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: usedDomFallback
        ? `Filled selector ${input.selector} with DOM persistence fallback`
        : `Filled selector ${input.selector}`,
    };
  }

  async enterCode(
    session: AdapterSessionHandle,
    input: {
      code: string;
      selector?: string;
      submit: boolean;
      timeoutMs?: number;
    },
  ) {
    if (!input.selector) {
      await session.page.keyboard.type(input.code);
      if (input.submit) {
        await session.page.keyboard.press("Enter");
      }
      return {
        url: session.page.url(),
        title: await session.page.title(),
        verificationHint: `Typed ${input.code.length}-character code with keyboard focus`,
      };
    }

    const targets = await resolveCodeTargets(session.page, input.selector);
    const count = await targets.count();

    if (count <= 1) {
      const locator = targets.first();
      const meta = await getEditableMeta(targets);
      await locator.click({ timeout: input.timeoutMs });
      if (meta.tag === "input" || meta.tag === "textarea") {
        await locator.fill(input.code, { timeout: input.timeoutMs });
      } else {
        await locator.pressSequentially(input.code, {
          timeout: input.timeoutMs,
        });
      }
      if (input.submit) {
        await locator.press("Enter", { timeout: input.timeoutMs });
      }
      return {
        url: session.page.url(),
        title: await session.page.title(),
        verificationHint: `Entered ${input.code.length}-character code into ${input.selector}`,
      };
    }

    const visibleIndexes: number[] = [];
    for (let index = 0; index < count; index += 1) {
      if (
        await targets
          .nth(index)
          .isVisible()
          .catch(() => false)
      ) {
        visibleIndexes.push(index);
      }
    }

    const targetIndexes =
      visibleIndexes.length > 0
        ? visibleIndexes
        : Array.from({ length: count }, (_, index) => index);
    if (targetIndexes.length < input.code.length) {
      throw new Error(
        `Not enough editable targets to enter ${input.code.length} code characters`,
      );
    }

    const characters = [...input.code];
    for (const [charIndex, char] of characters.entries()) {
      const locator = targets.nth(targetIndexes[charIndex]!);
      await locator.click({ timeout: input.timeoutMs });
      await locator.fill(char, { timeout: input.timeoutMs });
    }

    if (input.submit) {
      const lastTargetIndex =
        targetIndexes[
          Math.min(characters.length - 1, targetIndexes.length - 1)
        ]!;
      await targets.nth(lastTargetIndex).press("Enter", {
        timeout: input.timeoutMs,
      });
    }

    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: `Entered segmented ${input.code.length}-character code into ${input.selector}`,
    };
  }

  async press(
    session: AdapterSessionHandle,
    input: { key: string; selector?: string; timeoutMs?: number },
  ) {
    if (input.selector) {
      const locator = session.page.locator(input.selector).first();
      await locator.press(input.key, { timeout: input.timeoutMs });
    } else {
      await session.page.keyboard.press(input.key);
    }
    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: input.selector
        ? `Pressed ${input.key} on ${input.selector}`
        : `Pressed ${input.key}`,
    };
  }

  async waitFor(
    session: AdapterSessionHandle,
    input: { selector?: string; text?: string; timeoutMs: number },
  ) {
    if (input.selector) {
      await session.page.waitForSelector(input.selector, {
        timeout: input.timeoutMs,
      });
    } else if (input.text) {
      await session.page
        .getByText(input.text, { exact: false })
        .first()
        .waitFor({ timeout: input.timeoutMs });
    }
    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: input.selector
        ? `Observed selector ${input.selector}`
        : `Observed text ${input.text}`,
    };
  }

  async wheel(
    session: AdapterSessionHandle,
    input: {
      selector?: string;
      deltaX: number;
      deltaY: number;
      steps: number;
      stepDelayMs: number;
      timeoutMs?: number;
    },
  ) {
    if (input.selector) {
      await session.page
        .locator(input.selector)
        .first()
        .hover({ timeout: input.timeoutMs });
    }

    const stepX = input.deltaX / input.steps;
    const stepY = input.deltaY / input.steps;

    for (let index = 0; index < input.steps; index += 1) {
      await session.page.mouse.wheel(stepX, stepY);
      if (input.stepDelayMs > 0 && index < input.steps - 1) {
        await session.page.waitForTimeout(input.stepDelayMs);
      }
    }

    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: input.selector
        ? `Scrolled on ${input.selector}`
        : `Scrolled viewport by (${input.deltaX}, ${input.deltaY})`,
    };
  }

  async drag(
    session: AdapterSessionHandle,
    input: {
      fromSelector: string;
      toSelector: string;
      steps: number;
      timeoutMs?: number;
    },
  ) {
    const source = await getElementCenter(session.page, input.fromSelector);
    const target = await getElementCenter(session.page, input.toSelector);
    await session.page.mouse.move(source.x, source.y);
    await session.page.mouse.down({ button: "left" });
    await session.page.mouse.move(target.x, target.y, { steps: input.steps });
    await session.page.mouse.up({ button: "left" });

    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: `Dragged from ${input.fromSelector} to ${input.toSelector}`,
    };
  }

  async swipe(
    session: AdapterSessionHandle,
    input: {
      selector?: string;
      startX?: number;
      startY?: number;
      deltaX: number;
      deltaY: number;
      speed: number;
    },
  ) {
    const cdp = await session.page.context().newCDPSession(session.page);
    const start = input.selector
      ? await getElementCenter(session.page, input.selector)
      : {
          x: input.startX ?? 0,
          y: input.startY ?? 0,
        };

    await cdp.send("Input.synthesizeScrollGesture", {
      x: Math.round(start.x),
      y: Math.round(start.y),
      xDistance: input.deltaX,
      yDistance: input.deltaY,
      speed: input.speed,
      gestureSourceType: "touch",
    });

    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: input.selector
        ? `Swiped on ${input.selector}`
        : `Swiped from (${start.x}, ${start.y}) by (${input.deltaX}, ${input.deltaY})`,
    };
  }

  async pinch(
    session: AdapterSessionHandle,
    input: {
      selector?: string;
      centerX?: number;
      centerY?: number;
      scaleFactor: number;
      speed: number;
    },
  ) {
    const cdp = await session.page.context().newCDPSession(session.page);
    const center = input.selector
      ? await getElementCenter(session.page, input.selector)
      : {
          x: input.centerX ?? 0,
          y: input.centerY ?? 0,
        };

    await cdp.send("Input.synthesizePinchGesture", {
      x: Math.round(center.x),
      y: Math.round(center.y),
      scaleFactor: input.scaleFactor,
      relativeSpeed: input.speed,
      gestureSourceType: "touch",
    });

    return {
      url: session.page.url(),
      title: await session.page.title(),
      verificationHint: input.selector
        ? `Pinched on ${input.selector} with scale ${input.scaleFactor}`
        : `Pinched at (${center.x}, ${center.y}) with scale ${input.scaleFactor}`,
    };
  }
}

export function createCloakBrowserAdapter(env: WebAgentEnv) {
  return new PlaywrightCloakBrowserAdapter(env);
}
