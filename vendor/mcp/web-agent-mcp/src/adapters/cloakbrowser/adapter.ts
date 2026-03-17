import type { BrowserContext, Page, ViewportSize } from "playwright-core";

export type AdapterProfileMode = "ephemeral" | "persistent";
export type WaitUntilState = "domcontentloaded" | "load" | "networkidle";

export type AdapterSessionHandle = {
  contextId: string;
  pageId: string;
  context: BrowserContext;
  page: Page;
  consoleEntries: AdapterConsoleEntry[];
  networkEntries: AdapterNetworkEntry[];
  profileMode: AdapterProfileMode;
  locale?: string;
  viewport: ViewportSize;
};

export type AdapterSessionCreateInput = {
  sessionId: string;
  profileMode: AdapterProfileMode;
  locale: string;
  timezoneId?: string;
  userDataDir?: string;
  profileDirectory?: string;
  humanize: boolean;
  launchArgs: string[];
  viewport: ViewportSize;
};

export type AdapterNavigationResult = {
  pageId: string;
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  elapsedMs: number;
};

export type AdapterA11yResult = {
  url: string;
  title?: string;
  tree: {
    role: string;
    name?: string;
    children: Array<{
      role: string;
      name?: string;
      tag?: string;
      text?: string;
    }>;
  };
};

export type AdapterDomResult = {
  url: string;
  title?: string;
  summary: {
    headings: string[];
    links: number;
    buttons: number;
    forms: number;
    inputs: number;
  };
};

export type AdapterTextResult = {
  url: string;
  title?: string;
  format: "text" | "markdown";
  content: string;
  truncated: boolean;
};

export type AdapterInteractiveElementSummary = {
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  text?: string;
  autocomplete?: string;
  visible: boolean;
};

export type AdapterFrameSummary = {
  index: number;
  name?: string;
  url: string;
  title?: string;
  text_preview: string;
  truncated: boolean;
  input_count: number;
  button_count: number;
};

export type AdapterPageStateResult = {
  url: string;
  title?: string;
  text: string;
  truncated: boolean;
  dom: AdapterDomResult["summary"];
  inputs: AdapterInteractiveElementSummary[];
  buttons: AdapterInteractiveElementSummary[];
  frames: AdapterFrameSummary[];
  recentNetwork: AdapterNetworkEntry[];
};

export type AdapterAuthState =
  | "email_prompt"
  | "password_prompt"
  | "phone_selection"
  | "verification_code"
  | "trust_prompt"
  | "authenticated"
  | "unknown";

export type AdapterAuthStateResult = {
  url: string;
  title?: string;
  state: AdapterAuthState;
  confidence: "high" | "medium" | "low";
  summary: string;
  evidence: string[];
  suggestedSelectors: string[];
  frames: AdapterFrameSummary[];
  recentNetwork: AdapterNetworkEntry[];
};

export type AdapterScreenshotResult = {
  url: string;
  title?: string;
  bytes: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
};

export type AdapterActionResult = {
  url: string;
  title?: string;
  verificationHint?: string;
};

export type AdapterElementBox = {
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

export type AdapterConsoleEntry = {
  type: string;
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  timestamp: string;
};

export type AdapterNetworkEntry = {
  url: string;
  method: string;
  status?: number;
  resourceType: string;
  outcome: "response" | "failed";
  failureText?: string;
  timestamp: string;
};

export type AdapterEvaluateResult = {
  url: string;
  title?: string;
  value: unknown;
};

export type AdapterWaitForNetworkResult = {
  url: string;
  title?: string;
  entry: AdapterNetworkEntry;
  elapsedMs: number;
};

export interface CloakBrowserAdapter {
  createSession(input: AdapterSessionCreateInput): Promise<AdapterSessionHandle>;
  closeSession(session: AdapterSessionHandle): Promise<void>;
  navigate(session: AdapterSessionHandle, url: string, waitUntil: WaitUntilState): Promise<AdapterNavigationResult>;
  observeA11y(session: AdapterSessionHandle): Promise<AdapterA11yResult>;
  observeDom(session: AdapterSessionHandle): Promise<AdapterDomResult>;
  observeText(session: AdapterSessionHandle, format: "text" | "markdown"): Promise<AdapterTextResult>;
  inspectPageState(session: AdapterSessionHandle, recentNetworkLimit: number): Promise<AdapterPageStateResult>;
  inspectAuthState(session: AdapterSessionHandle, recentNetworkLimit: number): Promise<AdapterAuthStateResult>;
  takeScreenshot(
    session: AdapterSessionHandle,
    mode: "viewport" | "full" | "element",
    format: "png" | "jpeg",
    quality?: number,
    selector?: string
  ): Promise<AdapterScreenshotResult>;
  observeBoxes(session: AdapterSessionHandle, selectors: string[]): Promise<AdapterElementBox[]>;
  observeConsole(session: AdapterSessionHandle, limit: number): Promise<AdapterConsoleEntry[]>;
  observeNetwork(session: AdapterSessionHandle, limit: number): Promise<AdapterNetworkEntry[]>;
  waitForNetwork(
    session: AdapterSessionHandle,
    input: {
      urlPattern: string;
      useRegex: boolean;
      status?: number;
      outcome?: AdapterNetworkEntry["outcome"];
      timeoutMs: number;
      pollIntervalMs: number;
    }
  ): Promise<AdapterWaitForNetworkResult>;
  evaluateJs(
    session: AdapterSessionHandle,
    input: {
      expression: string;
      awaitPromise: boolean;
    }
  ): Promise<AdapterEvaluateResult>;
  click(
    session: AdapterSessionHandle,
    input: {
      selector: string;
      button: "left" | "right" | "middle";
      clickCount: number;
      timeoutMs?: number;
    }
  ): Promise<AdapterActionResult>;
  fill(
    session: AdapterSessionHandle,
    input: {
      selector: string;
      value: string;
      clearFirst: boolean;
      timeoutMs?: number;
    }
  ): Promise<AdapterActionResult>;
  enterCode(
    session: AdapterSessionHandle,
    input: {
      code: string;
      selector?: string;
      submit: boolean;
      timeoutMs?: number;
    }
  ): Promise<AdapterActionResult>;
  press(
    session: AdapterSessionHandle,
    input: {
      key: string;
      selector?: string;
      timeoutMs?: number;
    }
  ): Promise<AdapterActionResult>;
  waitFor(
    session: AdapterSessionHandle,
    input: {
      selector?: string;
      text?: string;
      timeoutMs: number;
    }
  ): Promise<AdapterActionResult>;
  wheel(
    session: AdapterSessionHandle,
    input: {
      selector?: string;
      deltaX: number;
      deltaY: number;
      steps: number;
      stepDelayMs: number;
      timeoutMs?: number;
    }
  ): Promise<AdapterActionResult>;
  drag(
    session: AdapterSessionHandle,
    input: {
      fromSelector: string;
      toSelector: string;
      steps: number;
      timeoutMs?: number;
    }
  ): Promise<AdapterActionResult>;
  swipe(
    session: AdapterSessionHandle,
    input: {
      selector?: string;
      startX?: number;
      startY?: number;
      deltaX: number;
      deltaY: number;
      speed: number;
    }
  ): Promise<AdapterActionResult>;
  pinch(
    session: AdapterSessionHandle,
    input: {
      selector?: string;
      centerX?: number;
      centerY?: number;
      scaleFactor: number;
      speed: number;
    }
  ): Promise<AdapterActionResult>;
}
