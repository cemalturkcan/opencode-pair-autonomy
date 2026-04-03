import {
  appendFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { PluginInput } from "@opencode-ai/plugin";
import { detectLocaleFromTexts, type SupportedLocale } from "../i18n";
import type { HarnessConfig, HookProfile } from "../types";
import { ensureDir, readJson, readText, writeJson } from "../utils";
import {
  promoteLearnedPatterns,
  renderInjectedPatterns,
} from "../learning/analyzer";
import {
  loadLearningArtifact,
  saveLearningArtifact,
  saveLearningMarkdown,
} from "../learning/store";
import type { LearnedPattern } from "../learning/types";
import {
  detectProjectFacts,
  joinProjectFactLabels,
  type ProjectFacts,
} from "../project-facts";

export type PersistedSessionSummary = {
  sessionID: string;
  savedAt: string;
  locale?: SupportedLocale;
  packageManager: string;
  languages: string[];
  frameworks: string[];
  changedFiles: string[];
  incompleteTodos: string[];
  lastUserMessage: string;
  lastAssistantMessage: string;
  approxTokens: number;
};

type PendingInjection = {
  injected: boolean;
};

export type Observation = {
  timestamp: string;
  phase: "pre" | "post" | "idle";
  sessionID?: string;
  agent?: string;
  tool?: string;
  note?: string;
};

function getStateRoot(config: HarnessConfig): string {
  if (config.memory?.directory) {
    return resolve(config.memory.directory);
  }

  const envDir = process.env.OPENCODE_CONFIG_DIR?.trim();
  const configDir = envDir
    ? resolve(envDir)
    : join(homedir(), ".config", "opencode");
  return join(configDir, "pair-autonomy-state");
}

function projectKey(directory: string): string {
  return createHash("sha1").update(directory).digest("hex").slice(0, 12);
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars
    ? text
    : `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function estimateTokens(chunks: string[]): number {
  const totalChars = chunks.join("\n").length;
  return Math.ceil(totalChars / 4);
}

export function resolveHookProfile(config: HarnessConfig): HookProfile {
  return config.hooks?.profile ?? "standard";
}

export function profileMatches(
  profile: HookProfile,
  allowed: HookProfile | HookProfile[],
): boolean {
  return (Array.isArray(allowed) ? allowed : [allowed]).includes(profile);
}

/**
 * Primary (user-facing) agent that should receive session-context injection.
 * Subagents spawned via Task tool should NOT get previous-session context
 * injected into their system prompt — it causes session mixing.
 */
export const PRIMARY_AGENTS = new Set(["yang"]);

/**
 * Resolve a session ID from a hook input object.
 *
 * IMPORTANT: Does NOT fall back to bare `candidate.id` because tool-execution
 * inputs often carry a tool-call / message `id` that is not a session ID.
 * Use {@link resolveSessionOrEntityID} in session-lifecycle hooks where the
 * input object IS the session itself and `.id` is the session ID.
 */
export function resolveSessionID(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;

  if (typeof obj.sessionID === "string") return obj.sessionID;

  if (obj.info && typeof obj.info === "object") {
    const info = obj.info as Record<string, unknown>;
    if (typeof info.id === "string") return info.id;
  }

  if (obj.session && typeof obj.session === "object") {
    const session = obj.session as Record<string, unknown>;
    if (typeof session.id === "string") return session.id;
  }

  return undefined;
}

/**
 * Like {@link resolveSessionID} but also falls back to bare `.id`.
 * Use ONLY for session-lifecycle hooks (session.created, session.idle,
 * session.deleted) where the input object represents the session itself.
 */
export function resolveSessionOrEntityID(value: unknown): string | undefined {
  const fromSession = resolveSessionID(value);
  if (fromSession) return fromSession;

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id === "string") return obj.id;
  }

  return undefined;
}

export function resolveAgentName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;

  if (typeof obj.agent === "string") return obj.agent;

  if (obj.message && typeof obj.message === "object") {
    const msg = obj.message as Record<string, unknown>;
    if (typeof msg.agent === "string") return msg.agent;
  }

  if (obj.info && typeof obj.info === "object") {
    const info = obj.info as Record<string, unknown>;
    if (typeof info.agent === "string") return info.agent;
  }

  return undefined;
}

export function resolveToolName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  return typeof obj.tool === "string" ? obj.tool : undefined;
}

export function resolveToolArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  return obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)
    ? (obj.args as Record<string, unknown>)
    : {};
}

export function resolveFilePathFromArgs(
  args: Record<string, unknown>,
): string | undefined {
  const value = args.filePath ?? args.path;
  return typeof value === "string" ? value : undefined;
}

export function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }
  if (!output || typeof output !== "object") {
    return "";
  }
  if (
    "text" in output &&
    typeof (output as { text?: unknown }).text === "string"
  ) {
    return (output as { text: string }).text;
  }
  if (
    "stdout" in output &&
    typeof (output as { stdout?: unknown }).stdout === "string"
  ) {
    return (output as { stdout: string }).stdout;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "";
  }
}

function renderSessionContext(params: {
  facts: ProjectFacts;
  latest: PersistedSessionSummary | undefined;
  learnedPatterns: LearnedPattern[];
  maxInjectedPatterns: number;
  maxChars: number;
}): string {
  const { facts, latest, learnedPatterns, maxInjectedPatterns, maxChars } =
    params;
  const parts = [
    "[SessionStart]",
    `Project package manager: ${facts.packageManager}`,
    `Project languages: ${facts.languages.length > 0 ? joinProjectFactLabels(facts.languages) : "unknown"}`,
    `Project frameworks: ${facts.frameworks.length > 0 ? joinProjectFactLabels(facts.frameworks) : "none detected"}`,
  ];

  if (latest) {
    parts.push(
      "Previous session summary:",
      `- Saved: ${latest.savedAt}`,
      `- Changed files: ${latest.changedFiles.length > 0 ? latest.changedFiles.join(", ") : "none recorded"}`,
      `- Incomplete todos: ${latest.incompleteTodos.length > 0 ? latest.incompleteTodos.join(" | ") : "none recorded"}`,
      `- Last user request: ${latest.lastUserMessage || "n/a"}`,
      `- Last assistant focus: ${latest.lastAssistantMessage || "n/a"}`,
    );
  }

  const injectedPatterns = renderInjectedPatterns(
    learnedPatterns,
    maxInjectedPatterns,
  );
  if (injectedPatterns.length > 0) {
    parts.push("Learned project patterns:", ...injectedPatterns);
  }

  parts.push(
    "Use this context only when it helps. Do not restate it unless relevant.",
  );
  return truncate(parts.join("\n"), maxChars);
}

export function createHookRuntime(ctx: PluginInput, config: HarnessConfig) {
  const root = getStateRoot(config);
  const projectRoot = join(root, projectKey(ctx.directory));
  const sessionsDir = join(projectRoot, "sessions");
  const learningDir = config.learning?.directory
    ? resolve(config.learning.directory, projectKey(ctx.directory))
    : join(projectRoot, "learning");
  const observationsPath = join(learningDir, "observations.ndjson");
  const learnedPatternsPath = join(learningDir, "patterns.json");
  const learnedPatternsMarkdownPath = join(learningDir, "patterns.md");
  const planModesPath = join(projectRoot, "plan-modes.json");
  const pendingInjection = new Map<string, PendingInjection>();
  const sessionAgents = new Map<string, string>();
  const sessionLocales = new Map<string, SupportedLocale>();
  const editedFiles = new Map<string, Set<string>>();
  const toolCounts = new Map<string, number>();
  const compactHints = new Map<string, number>();

  // ── Coordinator-specific state ────────────────────────────────
  const planModes = new Map<string, "planning" | "executing">();
  let planModesLoadedFromDisk = false;

  function loadPlanModesFromDisk(): void {
    if (planModesLoadedFromDisk) return;
    planModesLoadedFromDisk = true;
    const persisted = readJson<Record<string, "planning" | "executing">>(
      planModesPath,
      {},
    );
    for (const [id, mode] of Object.entries(persisted)) {
      if (!planModes.has(id) && (mode === "planning" || mode === "executing")) {
        planModes.set(id, mode);
      }
    }
  }

  function persistPlanModes(): void {
    const entries: Record<string, "planning" | "executing"> = {};
    for (const [id, mode] of planModes) {
      entries[id] = mode;
    }
    writeJson(planModesPath, entries);
  }

  const planModeBlockCounts = new Map<string, number>();
  const workerMessageCounts = new Map<string, number>();
  const reviewCycleCounts = new Map<string, number>();

  const MAX_TRACKED_SESSIONS = 50;
  const sessionMaps = [
    pendingInjection,
    sessionAgents,
    sessionLocales,
    editedFiles,
    toolCounts,
    compactHints,
    planModes,
    planModeBlockCounts,
    workerMessageCounts,
    reviewCycleCounts,
  ] as Map<string, unknown>[];

  function evictStaleSessions(): void {
    if (pendingInjection.size <= MAX_TRACKED_SESSIONS) return;
    const staleCount = pendingInjection.size - MAX_TRACKED_SESSIONS;
    const staleKeys = [...pendingInjection.keys()].slice(0, staleCount);
    for (const key of staleKeys) {
      for (const map of sessionMaps) {
        map.delete(key);
      }
    }
  }

  let wslMode = ctx.directory.startsWith("/mnt/");
  let wslWinPath = wslMode
    ? ctx.directory
        .replace(/^\/mnt\/(\w)/, (_, d: string) => `${d.toUpperCase()}:`)
        .replace(/\//g, "\\")
    : "";

  ensureDir(sessionsDir);
  ensureDir(learningDir);

  function getLatestSummaryPath(): string {
    return join(sessionsDir, "latest.json");
  }

  function setSessionAgent(sessionID: string, agent: string | undefined): void {
    if (!agent) {
      return;
    }
    sessionAgents.set(sessionID, agent);
  }

  function getSessionAgent(sessionID: string): string | undefined {
    return sessionAgents.get(sessionID);
  }

  function setSessionLocale(
    sessionID: string,
    locale: SupportedLocale | undefined,
  ): void {
    if (!locale) {
      return;
    }
    sessionLocales.set(sessionID, locale);
  }

  function getSessionLocale(sessionID: string): SupportedLocale | undefined {
    return sessionLocales.get(sessionID);
  }

  function resolveLocale(
    sessionID?: string,
    ...texts: Array<string | undefined>
  ): SupportedLocale {
    if (sessionID && sessionLocales.has(sessionID)) {
      return sessionLocales.get(sessionID) ?? "en";
    }

    const latest = loadLatestSummary();
    return detectLocaleFromTexts(
      ...texts,
      latest?.locale,
      latest?.lastUserMessage,
      latest?.lastAssistantMessage,
    );
  }

  function rememberEditedFile(sessionID: string, filePath: string): void {
    const next = editedFiles.get(sessionID) ?? new Set<string>();
    next.add(filePath);
    editedFiles.set(sessionID, next);
  }

  function getEditedFiles(sessionID: string): string[] {
    return [...(editedFiles.get(sessionID) ?? new Set<string>())].sort();
  }

  function incrementToolCount(sessionID: string): number {
    const next = (toolCounts.get(sessionID) ?? 0) + 1;
    toolCounts.set(sessionID, next);
    return next;
  }

  function shouldSuggestCompact(
    sessionID: string,
    threshold = 50,
    repeat = 25,
  ): boolean {
    const count = toolCounts.get(sessionID) ?? 0;
    if (count < threshold) {
      return false;
    }

    const lastHint = compactHints.get(sessionID) ?? 0;
    if (count === threshold || count - lastHint >= repeat) {
      compactHints.set(sessionID, count);
      return true;
    }
    return false;
  }

  function loadLatestSummary(): PersistedSessionSummary | undefined {
    // Scan timestamped session files instead of relying on latest.json
    // which suffers from race conditions when multiple sessions go idle
    // at the same time.  Filenames are ISO-timestamp-prefixed so
    // lexicographic sort == chronological sort.
    try {
      const files = readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".json") && f !== "latest.json")
        .sort();
      const newest = files[files.length - 1];
      if (newest) {
        return readJson<PersistedSessionSummary | undefined>(
          join(sessionsDir, newest),
          undefined,
        );
      }
    } catch {
      // Directory may not exist yet — fall through
    }
    // Backwards-compat fallback for existing latest.json
    return readJson<PersistedSessionSummary | undefined>(
      getLatestSummaryPath(),
      undefined,
    );
  }

  function prepareSessionContext(sessionID: string): void {
    evictStaleSessions();
    pendingInjection.set(sessionID, {
      injected: false,
    });
  }

  function consumePendingInjection(
    sessionID: string,
    locale?: SupportedLocale,
  ): string | undefined {
    const entry = pendingInjection.get(sessionID);
    if (!entry || entry.injected) {
      return undefined;
    }
    entry.injected = true;

    const latest =
      config.memory?.enabled === false ? undefined : loadLatestSummary();
    return renderSessionContext({
      facts: detectProjectFacts(ctx.directory),
      latest,
      learnedPatterns: loadLearnedPatterns(),
      maxInjectedPatterns: config.learning?.max_injected_patterns ?? 5,
      maxChars: config.memory?.max_injected_chars ?? 3500,
    });
  }

  function cleanupOldSessions(maxAgeDays = 7): void {
    try {
      const files = readdirSync(sessionsDir).filter(
        (f) => f.endsWith(".json") && f !== "latest.json",
      );
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = join(sessionsDir, file);
        try {
          const stat = statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            unlinkSync(filePath);
          }
        } catch {
          // skip files we can't stat
        }
      }
    } catch {
      // directory may not exist
    }
  }

  function saveSessionSummary(summary: PersistedSessionSummary): void {
    // Write only the timestamped file — each session gets its own file so
    // concurrent idle events cannot overwrite each other.
    // loadLatestSummary() now scans the directory for the newest file.
    writeJson(
      join(
        sessionsDir,
        `${summary.savedAt.replace(/[:.]/g, "-")}-${summary.sessionID}.json`,
      ),
      summary,
    );
    cleanupOldSessions(config.memory?.lookback_days ?? 7);
  }

  let observationAppendCount = 0;

  function rotateObservations(maxLines = 500): void {
    const content = readText(observationsPath);
    if (!content) return;

    const lines = content.split("\n").filter(Boolean);
    if (lines.length <= maxLines) return;

    // Keep the most recent entries
    const kept = lines.slice(-maxLines);
    writeFileSync(observationsPath, kept.join("\n") + "\n", "utf8");
  }

  function appendObservation(observation: Observation): void {
    if (config.learning?.enabled === false) {
      return;
    }
    ensureDir(learningDir);
    appendFileSync(
      observationsPath,
      `${JSON.stringify(observation)}\n`,
      "utf8",
    );

    observationAppendCount++;
    if (observationAppendCount % 50 === 0) {
      rotateObservations();
    }
  }

  function loadObservations(limit = 200): Observation[] {
    const content = readText(observationsPath);
    if (!content) {
      return [];
    }

    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as Observation;
        } catch {
          return undefined;
        }
      })
      .filter((value): value is Observation => Boolean(value));
  }

  function loadLearnedPatterns(): LearnedPattern[] {
    return loadLearningArtifact(learnedPatternsPath).patterns;
  }

  function promoteLearning(summary: PersistedSessionSummary): LearnedPattern[] {
    if (
      config.learning?.enabled === false ||
      config.learning?.auto_promote === false
    ) {
      return loadLearnedPatterns();
    }

    const observations = loadObservations();
    if (observations.length < (config.learning?.min_observations ?? 6)) {
      return loadLearnedPatterns();
    }

    const nextPatterns = promoteLearnedPatterns({
      existing: loadLearnedPatterns(),
      summary,
      facts: detectProjectFacts(ctx.directory),
      observations,
      maxPatterns: config.learning?.max_patterns ?? 24,
    });

    saveLearningArtifact(learnedPatternsPath, nextPatterns);
    saveLearningMarkdown(learnedPatternsMarkdownPath, nextPatterns);
    return nextPatterns;
  }

  function clearSession(sessionID: string): void {
    pendingInjection.delete(sessionID);
    sessionAgents.delete(sessionID);
    sessionLocales.delete(sessionID);
    editedFiles.delete(sessionID);
    toolCounts.delete(sessionID);
    compactHints.delete(sessionID);
    planModes.delete(sessionID);
    planModeBlockCounts.delete(sessionID);
    workerMessageCounts.delete(sessionID);
    reviewCycleCounts.delete(sessionID);
    persistPlanModes();
  }

  // ── Plan mode ─────────────────────────────────────────────────
  function getPlanMode(sessionID: string): "planning" | "executing" {
    loadPlanModesFromDisk();
    return planModes.get(sessionID) ?? "planning";
  }

  function setPlanMode(
    sessionID: string,
    mode: "planning" | "executing",
  ): void {
    planModes.set(sessionID, mode);
    if (mode === "planning") {
      planModeBlockCounts.delete(sessionID);
    }
    persistPlanModes();
  }

  function incrementPlanModeBlock(sessionID: string): number {
    const count = (planModeBlockCounts.get(sessionID) ?? 0) + 1;
    planModeBlockCounts.set(sessionID, count);
    return count;
  }

  function resetPlanModeBlockCount(sessionID: string): void {
    planModeBlockCounts.delete(sessionID);
  }

  // ── Worker continuation ───────────────────────────────────────
  function incrementWorkerMessages(workerID: string): number {
    const count = (workerMessageCounts.get(workerID) ?? 0) + 1;
    workerMessageCounts.set(workerID, count);
    return count;
  }

  function shouldSpawnFresh(workerID: string): boolean {
    return (workerMessageCounts.get(workerID) ?? 0) >= 5;
  }

  // ── Review cycles ─────────────────────────────────────────────
  function incrementReviewCycle(sessionID: string): number {
    const count = (reviewCycleCounts.get(sessionID) ?? 0) + 1;
    reviewCycleCounts.set(sessionID, count);
    return count;
  }

  function getReviewCycleCount(sessionID: string): number {
    return reviewCycleCounts.get(sessionID) ?? 0;
  }

  // ── WSL ────────────────────────────────────────────────────────
  function isWsl(): boolean {
    return wslMode;
  }

  function getWslWinPath(): string {
    return wslWinPath;
  }

  // ── Mode injection for system prompt ──────────────────────────
  function buildModeInjection(sessionID: string): string {
    const mode = getPlanMode(sessionID);
    const parts: string[] = [];

    if (mode === "planning") {
      parts.push(
        "[Mode: Planning] Create your plan with TodoWrite. User will /go to execute.",
      );
    } else {
      parts.push(
        "[Mode: Executing] Proceed with worker spawning and todo execution.",
      );
    }

    if (wslMode) {
      parts.push(
        `[WSL] Windows project at ${wslWinPath}. Read/Edit via /mnt/ paths.`,
        "Node tools (npm/pnpm/yarn/bun/npx/bunx/node/tsc/tsx/vite/next/nuxt/vitest/jest/eslint/prettier): run via cmd.exe.",
        "Git/SSH/curl/grep: WSL bash OK.",
      );
    }

    return parts.join("\n");
  }

  return {
    detectProjectFacts: () => detectProjectFacts(ctx.directory),
    estimateTokens,
    loadLatestSummary,
    loadLearnedPatterns,
    prepareSessionContext,
    consumePendingInjection,
    saveSessionSummary,
    appendObservation,
    promoteLearning,
    setSessionAgent,
    getSessionAgent,
    setSessionLocale,
    getSessionLocale,
    resolveLocale,
    rememberEditedFile,
    getEditedFiles,
    incrementToolCount,
    shouldSuggestCompact,
    clearSession,
    readText,
    // Coordinator state
    getPlanMode,
    setPlanMode,
    incrementPlanModeBlock,
    resetPlanModeBlockCount,
    incrementWorkerMessages,
    shouldSpawnFresh,
    incrementReviewCycle,
    getReviewCycleCount,
    isWsl,
    getWslWinPath,
    buildModeInjection,
  };
}

export type HookRuntime = ReturnType<typeof createHookRuntime>;
