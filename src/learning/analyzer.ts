import { getAllSignals, matchesAnySignal } from "../i18n";
import type { PersistedSessionSummary, Observation } from "../hooks/runtime";
import { getProjectFactLabel, type ProjectFacts } from "../project-facts";
import type {
  LearningCandidate,
  LearningEvidence,
  LearnedPattern,
} from "./types";

const USER_PREFERENCE_RULES: Array<{ id: string; baseConfidence: number }> = [
  {
    id: "user:no-routine-permission-asks",
    baseConfidence: 0.72,
  },
  {
    id: "user:explain-disagreement-explicitly",
    baseConfidence: 0.7,
  },
  {
    id: "user:subagents-are-exceptional",
    baseConfidence: 0.75,
  },
  {
    id: "user:implement-in-phases",
    baseConfidence: 0.68,
  },
];

function clampConfidence(value: number): number {
  return Math.max(0.35, Math.min(0.95, Math.round(value * 100) / 100));
}

function asEvidence(text: string, limit = 140): LearningEvidence {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return {
    messageKey: "learning.evidence.message",
    values: {
      text:
        cleaned.length <= limit
          ? cleaned
          : `${cleaned.slice(0, Math.max(0, limit - 3))}...`,
    },
  };
}

function stackValueFromFacts(facts: ProjectFacts): string {
  return [...facts.languages, ...facts.frameworks].join("|");
}

function collectUserPreferenceCandidates(
  summary: PersistedSessionSummary,
): LearningCandidate[] {
  const source = [summary.lastUserMessage, summary.lastAssistantMessage]
    .filter(Boolean)
    .join("\n");
  if (!source) {
    return [];
  }

  return USER_PREFERENCE_RULES.filter((rule) =>
    matchesAnySignal(source, getAllSignals("preferences", rule.id)),
  ).map((rule) => ({
    id: rule.id,
    kind: "user_preference" as const,
    summaryKey: `learning.pattern.${rule.id}`,
    evidence: asEvidence(source),
    baseConfidence: rule.baseConfidence,
  }));
}

function collectRepoConventionCandidates(
  facts: ProjectFacts,
): LearningCandidate[] {
  const candidates: LearningCandidate[] = [];

  if (facts.packageManager !== "unknown") {
    candidates.push({
      id: `repo:package-manager:${facts.packageManager}`,
      kind: "repo_convention",
      summaryKey: "learning.pattern.repo:package-manager",
      summaryValues: { packageManager: facts.packageManager },
      evidence: {
        messageKey: "learning.evidence.package_manager",
        values: { packageManager: facts.packageManager },
      },
      baseConfidence: 0.78,
    });
  }

  if (facts.languages.length > 0 || facts.frameworks.length > 0) {
    candidates.push({
      id: `repo:stack:${[...facts.languages, ...facts.frameworks].join("|").toLowerCase()}`,
      kind: "repo_convention",
      summaryKey: "learning.pattern.repo:stack",
      summaryValues: { stack: stackValueFromFacts(facts) },
      evidence: {
        messageKey: "learning.evidence.stack",
        values: { stack: stackValueFromFacts(facts) },
      },
      baseConfidence: 0.66,
    });
  }

  return candidates;
}

function collectObservationCandidates(
  observations: Observation[],
): LearningCandidate[] {
  const noteCounts = new Map<string, number>();

  for (const observation of observations) {
    const note = observation.note?.trim();
    if (!note) {
      continue;
    }
    noteCounts.set(note, (noteCounts.get(note) ?? 0) + 1);
  }

  const candidates: LearningCandidate[] = [];

  if ((noteCounts.get("prefer_pty_for_long_running_command") ?? 0) > 0) {
    candidates.push({
      id: "tooling:prefer-pty-for-long-running-commands",
      kind: "tooling_pattern",
      summaryKey:
        "learning.pattern.tooling:prefer-pty-for-long-running-commands",
      evidence: {
        messageKey: "learning.evidence.long_running",
        values: {
          count: noteCounts.get("prefer_pty_for_long_running_command") ?? 0,
        },
      },
      baseConfidence: 0.64,
    });
  }

  if ((noteCounts.get("console_log_found") ?? 0) > 0) {
    candidates.push({
      id: "failure:console-log-regression",
      kind: "failure_pattern",
      summaryKey: "learning.pattern.failure:console-log-regression",
      evidence: {
        messageKey: "learning.evidence.console_log",
        values: { count: noteCounts.get("console_log_found") ?? 0 },
      },
      baseConfidence: 0.57,
    });
  }

  if ((noteCounts.get("build_or_test_failure_detected") ?? 0) > 0) {
    candidates.push({
      id: "workflow:verify-after-build-failure",
      kind: "workflow_rule",
      summaryKey: "learning.pattern.workflow:verify-after-build-failure",
      evidence: {
        messageKey: "learning.evidence.build_failure",
        values: {
          count: noteCounts.get("build_or_test_failure_detected") ?? 0,
        },
      },
      baseConfidence: 0.62,
    });
  }

  return candidates;
}

function mergePattern(
  existing: LearnedPattern | undefined,
  candidate: LearningCandidate,
  now: string,
): LearnedPattern {
  const evidence = [candidate.evidence, ...(existing?.evidence ?? [])]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 6);
  const occurrences = (existing?.occurrences ?? 0) + 1;
  const boosted =
    Math.max(existing?.confidence ?? 0, candidate.baseConfidence) +
    (occurrences - 1) * 0.12;

  return {
    id: candidate.id,
    kind: candidate.kind,
    summary: existing?.summary ?? candidate.summary,
    summaryKey: candidate.summaryKey ?? existing?.summaryKey,
    summaryValues: candidate.summaryValues ?? existing?.summaryValues,
    confidence: clampConfidence(boosted),
    occurrences,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    evidence,
    source: existing?.source ?? "automatic",
  };
}

export function promoteLearnedPatterns(params: {
  existing: LearnedPattern[];
  summary: PersistedSessionSummary;
  facts: ProjectFacts;
  observations: Observation[];
  maxPatterns: number;
}): LearnedPattern[] {
  const { existing, summary, facts, observations, maxPatterns } = params;
  const now = new Date().toISOString();
  const map = new Map(existing.map((pattern) => [pattern.id, pattern]));
  const candidates = [
    ...collectUserPreferenceCandidates(summary),
    ...collectRepoConventionCandidates(facts),
    ...collectObservationCandidates(observations),
  ];

  for (const candidate of candidates) {
    map.set(candidate.id, mergePattern(map.get(candidate.id), candidate, now));
  }

  return [...map.values()]
    .sort(
      (a, b) =>
        b.confidence - a.confidence || b.lastSeen.localeCompare(a.lastSeen),
    )
    .slice(0, maxPatterns);
}

function renderPatternSummary(pattern: LearnedPattern): string {
  if (pattern.summary) return pattern.summary;

  switch (pattern.id) {
    case "user:no-routine-permission-asks":
      return "Do not ask the user for routine permission; proceed unless an external blocker exists.";
    case "user:explain-disagreement-explicitly":
      return "When disagreeing, explain the tradeoff explicitly instead of silently overriding the user.";
    case "user:subagents-are-exceptional":
      return "Use subagents sparingly; reserve them for large scans, async work, research, or bounded repair/verification.";
    case "user:implement-in-phases":
      return "Implement larger changes in phases instead of forcing them into one jump.";
    case "workflow:verify-after-build-failure":
      return "When build or test commands fail, follow with verification or repair instead of treating the full log as equal-priority noise.";
    case "failure:console-log-regression":
      return "Watch for stray `console.log` statements after edits; they recur often enough to merit explicit checks.";
    case "tooling:prefer-pty-for-long-running-commands":
      return "Prefer PTY/background sessions for long-running build, test, and server commands.";
    default: {
      // Handle dynamic IDs like "repo:package-manager:bun" and "repo:stack:typescript|react"
      if (pattern.id.startsWith("repo:package-manager:")) {
        const pm = pattern.id.split(":")[2] ?? "unknown";
        return `Prefer ${pm} as the default package manager for this repository.`;
      }
      if (pattern.id.startsWith("repo:stack:")) {
        const stack = pattern.id.split(":").slice(2).join(":");
        const labels = stack
          .split("|")
          .filter(Boolean)
          .map((id) => getProjectFactLabel(id))
          .join(", ");
        return `Repository stack centers on ${labels || "unknown"}.`;
      }
      return pattern.id;
    }
  }
}

function renderEvidence(evidence: LearningEvidence): string {
  if (typeof evidence === "string") return evidence;
  if (evidence.text) return evidence.text;

  const values = evidence.values ?? {};
  switch (evidence.messageKey) {
    case "learning.evidence.message":
      return `message: ${String(values.text ?? "")}`;
    case "learning.evidence.package_manager":
      return `Detected package manager: ${String(values.packageManager ?? "unknown")}`;
    case "learning.evidence.stack": {
      const stack = String(values.stack ?? "unknown");
      const labels = stack
        .split("|")
        .filter(Boolean)
        .map((id) => getProjectFactLabel(id))
        .join(", ");
      return `Detected languages/frameworks: ${labels || "unknown"}`;
    }
    case "learning.evidence.long_running":
      return `Long-running command reminders seen ${String(values.count ?? 0)} time(s)`;
    case "learning.evidence.console_log":
      return `console.log warnings seen ${String(values.count ?? 0)} time(s)`;
    case "learning.evidence.build_failure":
      return `Build/test failures recorded ${String(values.count ?? 0)} time(s)`;
    default:
      return "";
  }
}

export function renderPatternKind(kind: LearnedPattern["kind"]): string {
  return kind.replace(/_/g, " ");
}

export function renderPatternHeading(kind: LearnedPattern["kind"]): string {
  switch (kind) {
    case "user_preference":
      return "User Preferences";
    case "repo_convention":
      return "Repo Conventions";
    case "workflow_rule":
      return "Workflow Rules";
    case "failure_pattern":
      return "Failure Patterns";
    case "tooling_pattern":
      return "Tooling Patterns";
    default:
      return kind;
  }
}

export function renderPatternEvidence(evidence: LearningEvidence): string {
  return renderEvidence(evidence);
}

export function renderInjectedPatterns(
  patterns: LearnedPattern[],
  limit: number,
): string[] {
  return patterns
    .slice()
    .sort(
      (a, b) =>
        b.confidence - a.confidence || b.lastSeen.localeCompare(a.lastSeen),
    )
    .slice(0, limit)
    .map(
      (pattern) =>
        `- [${renderPatternKind(pattern.kind)}] ${renderPatternSummary(pattern)} (confidence ${pattern.confidence.toFixed(2)})`,
    );
}

export function getPatternSummary(pattern: LearnedPattern): string {
  return renderPatternSummary(pattern);
}
