import type { WebAgentEnv } from "../config/env.js";
import { WebAgentError } from "./errors.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import { shouldRecommendSessionRestart } from "./session-restart-policy.js";
import type {
  AdapterConsoleEntry,
  AdapterElementBox,
  AdapterNetworkEntry,
  AdapterProfileMode,
  AdapterSessionHandle,
  CloakBrowserAdapter,
  WaitUntilState,
} from "../adapters/cloakbrowser/adapter.js";

export type ManagedPage = {
  pageId: string;
  createdAt: string;
  url?: string;
  title?: string;
  lastObservationAt?: string;
  lastActionAt?: string;
};

export type ManagedSession = {
  sessionId: string;
  contextId: string;
  createdAt: string;
  status: "active" | "closing" | "closed" | "error";
  profileMode: AdapterProfileMode;
  locale?: string;
  timezoneId?: string;
  userDataDir?: string;
  profileDirectory?: string;
  humanize: boolean;
  launchArgs: string[];
  viewport: {
    width: number;
    height: number;
  };
  consecutiveErrors: number;
  lastErrorAt?: string;
  lastRestartAt?: string;
  pages: Map<string, ManagedPage>;
  primaryPageId: string;
  adapterSession: AdapterSessionHandle;
};

type SessionManagerDeps = {
  env: WebAgentEnv;
  adapter: CloakBrowserAdapter;
};

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(private readonly deps: SessionManagerDeps) {}

  async createSession(input: {
    profileMode: AdapterProfileMode;
    locale?: string;
    timezoneId?: string;
    userDataDir?: string;
    profileDirectory?: string;
    humanize?: boolean;
    launchArgs?: string[];
    viewport?: { width: number; height: number };
  }) {
    const sessionId = createId("session");
    const locale = input.locale ?? this.deps.env.defaultLocale;
    const timezoneId = input.timezoneId ?? this.deps.env.defaultTimezoneId;
    const userDataDir = input.userDataDir ?? this.deps.env.chromeUserDataDir;
    const profileDirectory =
      input.profileDirectory ?? this.deps.env.chromeProfileDirectory;
    const humanize = input.humanize ?? this.deps.env.defaultHumanize;
    const launchArgs = [
      ...(input.launchArgs ?? this.deps.env.defaultLaunchArgs),
      ...(profileDirectory ? [`--profile-directory=${profileDirectory}`] : []),
    ];
    const viewport = input.viewport ?? this.deps.env.defaultViewport;
    const adapterSession = await this.deps.adapter.createSession({
      sessionId,
      profileMode: input.profileMode,
      locale,
      timezoneId,
      userDataDir,
      profileDirectory,
      humanize,
      launchArgs,
      viewport,
    });

    const page: ManagedPage = {
      pageId: adapterSession.pageId,
      createdAt: nowIso(),
    };

    const session: ManagedSession = {
      sessionId,
      contextId: adapterSession.contextId,
      createdAt: nowIso(),
      status: "active",
      profileMode: input.profileMode,
      locale,
      timezoneId,
      userDataDir,
      profileDirectory,
      humanize,
      launchArgs,
      viewport,
      consecutiveErrors: 0,
      primaryPageId: page.pageId,
      pages: new Map([[page.pageId, page]]),
      adapterSession,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "closed") {
      throw new WebAgentError(
        "INPUT_MISSING_SESSION",
        `Session not found: ${sessionId}`,
        { sessionId },
      );
    }
    return session;
  }

  getPage(sessionId: string, pageId?: string) {
    const session = this.getSession(sessionId);
    const resolvedPageId = pageId ?? session.primaryPageId;
    const page = session.pages.get(resolvedPageId);
    if (!page) {
      throw new WebAgentError(
        "STATE_PAGE_NOT_FOUND",
        `Page not found: ${resolvedPageId}`,
        {
          sessionId,
          pageId: resolvedPageId,
        },
      );
    }
    return { session, page };
  }

  updatePage(sessionId: string, pageId: string, patch: Partial<ManagedPage>) {
    const { session, page } = this.getPage(sessionId, pageId);
    session.pages.set(pageId, { ...page, ...patch });
  }

  recordSuccess(sessionId: string) {
    const session = this.getSession(sessionId);
    session.consecutiveErrors = 0;
    session.lastErrorAt = undefined;
    this.sessions.set(sessionId, session);
  }

  recordFailure(sessionId: string) {
    const session = this.getSession(sessionId);
    session.consecutiveErrors += 1;
    session.lastErrorAt = nowIso();
    this.sessions.set(sessionId, session);
    return session;
  }

  getSessionHealth(sessionId: string) {
    const session = this.getSession(sessionId);
    return {
      consecutiveErrors: session.consecutiveErrors,
      lastErrorAt: session.lastErrorAt,
      lastRestartAt: session.lastRestartAt,
      restartRecommended: shouldRecommendSessionRestart({
        consecutiveErrors: session.consecutiveErrors,
        maxConsecutiveErrors: this.deps.env.sessionMaxConsecutiveErrors,
        cooldownMs: this.deps.env.sessionRestartCooldownMs,
        lastRestartAt: session.lastRestartAt,
        now: nowIso(),
        browserError: false,
      }).recommended,
    };
  }

  async restartSession(sessionId: string) {
    const session = this.getSession(sessionId);
    const previous = {
      profileMode: session.profileMode,
      locale: session.locale,
      timezoneId: session.timezoneId,
      userDataDir: session.userDataDir,
      profileDirectory: session.profileDirectory,
      humanize: session.humanize,
      launchArgs: session.launchArgs,
      viewport: session.viewport,
    };
    await this.deps.adapter.closeSession(session.adapterSession);
    const adapterSession = await this.deps.adapter.createSession({
      sessionId,
      profileMode: previous.profileMode,
      locale: previous.locale ?? this.deps.env.defaultLocale,
      timezoneId: previous.timezoneId,
      humanize: previous.humanize,
      launchArgs: previous.launchArgs,
      viewport: previous.viewport,
    });
    const restarted: ManagedSession = {
      ...session,
      contextId: adapterSession.contextId,
      status: "active",
      consecutiveErrors: 0,
      lastErrorAt: undefined,
      lastRestartAt: nowIso(),
      primaryPageId: adapterSession.pageId,
      pages: new Map([
        [
          adapterSession.pageId,
          { pageId: adapterSession.pageId, createdAt: nowIso() },
        ],
      ]),
      adapterSession,
    };
    this.sessions.set(sessionId, restarted);
    return restarted;
  }

  async navigate(
    sessionId: string,
    pageId: string | undefined,
    url: string,
    waitUntil: WaitUntilState,
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.navigate(
      session.adapterSession,
      url,
      waitUntil,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.finalUrl,
      title: result.title,
      lastActionAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async observeA11y(sessionId: string, pageId?: string) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.observeA11y(session.adapterSession);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async observeDom(sessionId: string, pageId?: string) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.observeDom(session.adapterSession);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async observeText(
    sessionId: string,
    pageId: string | undefined,
    format: "text" | "markdown",
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.observeText(
      session.adapterSession,
      format,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async observePageState(
    sessionId: string,
    pageId: string | undefined,
    recentNetworkLimit: number,
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.inspectPageState(
      session.adapterSession,
      recentNetworkLimit,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async observeAuthState(
    sessionId: string,
    pageId: string | undefined,
    recentNetworkLimit: number,
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.inspectAuthState(
      session.adapterSession,
      recentNetworkLimit,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async takeScreenshot(
    sessionId: string,
    pageId: string | undefined,
    mode: "viewport" | "full" | "element",
    format: "png" | "jpeg",
    quality?: number,
    selector?: string,
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.takeScreenshot(
      session.adapterSession,
      mode,
      format,
      quality,
      selector,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async observeBoxes(
    sessionId: string,
    pageId: string | undefined,
    selectors: string[],
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.observeBoxes(
      session.adapterSession,
      selectors,
    );
    this.updatePage(session.sessionId, page.pageId, {
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async observeConsole(
    sessionId: string,
    pageId: string | undefined,
    limit: number,
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.observeConsole(
      session.adapterSession,
      limit,
    );
    this.updatePage(session.sessionId, page.pageId, {
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async observeNetwork(
    sessionId: string,
    pageId: string | undefined,
    limit: number,
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.observeNetwork(
      session.adapterSession,
      limit,
    );
    this.updatePage(session.sessionId, page.pageId, {
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async waitForNetwork(
    sessionId: string,
    pageId: string | undefined,
    input: {
      urlPattern: string;
      useRegex: boolean;
      status?: number;
      outcome?: "response" | "failed";
      timeoutMs: number;
      pollIntervalMs: number;
    },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.waitForNetwork(
      session.adapterSession,
      input,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async evaluateJs(
    sessionId: string,
    pageId: string | undefined,
    input: { expression: string; awaitPromise: boolean },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.evaluateJs(
      session.adapterSession,
      input,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async click(
    sessionId: string,
    pageId: string | undefined,
    input: {
      selector: string;
      button: "left" | "right" | "middle";
      clickCount: number;
      timeoutMs?: number;
    },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.click(session.adapterSession, input);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async fill(
    sessionId: string,
    pageId: string | undefined,
    input: {
      selector: string;
      value: string;
      clearFirst: boolean;
      timeoutMs?: number;
    },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.fill(session.adapterSession, input);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async enterCode(
    sessionId: string,
    pageId: string | undefined,
    input: {
      code: string;
      selector?: string;
      submit: boolean;
      timeoutMs?: number;
    },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.enterCode(
      session.adapterSession,
      input,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async press(
    sessionId: string,
    pageId: string | undefined,
    input: { key: string; selector?: string; timeoutMs?: number },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.press(session.adapterSession, input);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async waitFor(
    sessionId: string,
    pageId: string | undefined,
    input: { selector?: string; text?: string; timeoutMs: number },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.waitFor(
      session.adapterSession,
      input,
    );
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async wheel(
    sessionId: string,
    pageId: string | undefined,
    input: {
      selector?: string;
      deltaX: number;
      deltaY: number;
      steps: number;
      stepDelayMs: number;
      timeoutMs?: number;
    },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.wheel(session.adapterSession, input);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async drag(
    sessionId: string,
    pageId: string | undefined,
    input: {
      fromSelector: string;
      toSelector: string;
      steps: number;
      timeoutMs?: number;
    },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.drag(session.adapterSession, input);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async swipe(
    sessionId: string,
    pageId: string | undefined,
    input: {
      selector?: string;
      startX?: number;
      startY?: number;
      deltaX: number;
      deltaY: number;
      speed: number;
    },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.swipe(session.adapterSession, input);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async pinch(
    sessionId: string,
    pageId: string | undefined,
    input: {
      selector?: string;
      centerX?: number;
      centerY?: number;
      scaleFactor: number;
      speed: number;
    },
  ) {
    const { session, page } = this.getPage(sessionId, pageId);
    const result = await this.deps.adapter.pinch(session.adapterSession, input);
    this.updatePage(session.sessionId, page.pageId, {
      url: result.url,
      title: result.title,
      lastActionAt: nowIso(),
      lastObservationAt: nowIso(),
    });
    return { session, page: this.getPage(sessionId, page.pageId).page, result };
  }

  async closeSession(sessionId: string) {
    const session = this.getSession(sessionId);
    session.status = "closing";
    await this.deps.adapter.closeSession(session.adapterSession);
    session.status = "closed";
    this.sessions.set(sessionId, session);
    return session;
  }
}
