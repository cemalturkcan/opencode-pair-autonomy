import type { PluginInput } from "@opencode-ai/plugin";

const INTERNAL_SESSION_TITLE = "[plugin] prompt-refiner";
const PLUGIN_SERVICE = "prompt-refiner";
const REFINER_AGENT_NAME = "prompt-refiner";
const DEFAULT_REFINER_MODEL = "anthropic/claude-haiku-4-5";

const internalSessionIDs = new Set<string>();
const pendingVisibleDebug = new Map<string, string>();
const processedFingerprints = new Map<string, string>();
/** Cache: fingerprint(originalText) → refinedText, so previous user messages
 *  get their refined version re-applied on every transform call. */
const refinedTextCache = new Map<string, string>();

const MAX_CACHE_SIZE = 200;

function evictCacheIfNeeded(): void {
  // processedFingerprints: sessionID → last fingerprint (always small, one per session)
  if (processedFingerprints.size > MAX_CACHE_SIZE) {
    const excess = processedFingerprints.size - MAX_CACHE_SIZE;
    const keys = [...processedFingerprints.keys()].slice(0, excess);
    for (const key of keys) processedFingerprints.delete(key);
  }

  // pendingVisibleDebug: sessionID → text (always small)
  if (pendingVisibleDebug.size > MAX_CACHE_SIZE) {
    const excess = pendingVisibleDebug.size - MAX_CACHE_SIZE;
    const keys = [...pendingVisibleDebug.keys()].slice(0, excess);
    for (const key of keys) pendingVisibleDebug.delete(key);
  }

  // refinedTextCache: fingerprint → refinedText (grows with unique messages)
  // Only evict if significantly over limit; keep active session fingerprints
  if (refinedTextCache.size > MAX_CACHE_SIZE) {
    const activeFingerprints = new Set(processedFingerprints.values());
    const excess = refinedTextCache.size - MAX_CACHE_SIZE;
    let evicted = 0;
    for (const key of refinedTextCache.keys()) {
      if (evicted >= excess) break;
      if (activeFingerprints.has(key)) continue;
      refinedTextCache.delete(key);
      evicted++;
    }
  }
}

function fingerprint(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `${hash}:${text.length}`;
}

const DEFAULT_REWRITE_SYSTEM_PROMPT = [
  "You are an expert prompt enhancer for a coding AI assistant.",
  "Your job is to transform raw user messages into precise, actionable engineering prompts.",
  "",
  "# Output Rules",
  "- Output ONLY the enhanced prompt. Nothing else.",
  "- NEVER add prefixes like 'User:', 'Enhanced:', 'Prompt:', 'Translation:' or ANY label.",
  "- If the message is in another language, translate it to English naturally.",
  "- Preserve code snippets, file paths, commands, identifiers, and explicit constraints exactly.",
  "- No commentary, no markdown fences wrapping the whole output.",
  "",
  "# Behavior by Message Type",
  "",
  "## Simple messages (greetings, yes/no, short follow-ups, acknowledgments):",
  "Just translate to English. Do NOT over-elaborate.",
  "- 'evet devam et' → 'Yes, continue.'",
  "- 'looks good' → 'Looks good.'",
  "",
  "## Technical / coding requests — apply ALL of these:",
  "",
  "### 1. Version & Stack Precision",
  "When a technology is mentioned without version or convention details, add the latest stable version and modern idioms:",
  "- 'Vue' → 'Vue 3 with Composition API, <script setup> syntax, and TypeScript'",
  "- 'React' → 'React 19+ with functional components and hooks'",
  "- 'Next.js' → 'Next.js 15+ with App Router and Server Components'",
  "- 'Python' → 'Python 3.12+'",
  "- 'Node' → 'Node.js 22+ with ES modules'",
  "- 'Spring Boot' → 'Spring Boot 3.x with Java 21+'",
  "- 'Tailwind' → 'Tailwind CSS v4'",
  "- 'Express' → 'Express 5+ (or Hono/Fastify if starting fresh)'",
  "If the user already specifies a version, keep it exactly.",
  "",
  "### 2. Modern Patterns & Best Practices",
  "Enrich with reasonable engineering expectations:",
  "- Prefer TypeScript over plain JavaScript unless JS is explicitly requested.",
  "- Expect proper error handling and meaningful error messages.",
  "- Expect accessible, semantic HTML for frontend work.",
  "- Expect responsive design unless explicitly scoped to a single viewport.",
  "- For APIs: expect proper validation, status codes, and error responses.",
  "- For database work: expect migrations, indexes on foreign keys, proper constraints.",
  "",
  "### 3. Clarification Markers [CLARIFY]",
  "When a critical detail is missing and guessing wrong would waste significant effort, add:",
  "  [CLARIFY: <specific question>]",
  "",
  "Use CLARIFY sparingly — only for genuinely ambiguous, high-impact decisions:",
  "- UI library choice not specified for a new frontend project",
  "- State management approach unclear for complex state",
  "- 'Fix the bug' without identifying which bug",
  "- Database or ORM choice missing for new backend work",
  "- Authentication strategy not mentioned when auth is clearly needed",
  "",
  "Do NOT add CLARIFY for things that have safe, obvious defaults.",
  "",
  "### 4. Scope Preservation (Critical)",
  "NEVER expand the request scope beyond what the user asked.",
  "- User asks for a button → enhance the button, don't plan a design system.",
  "- User asks to fix one file → don't suggest rewriting the module.",
  "- Keep the enhanced prompt proportional to the original.",
  "",
  "# Examples",
  "",
  "Input: 'vue ile bir login sayfası yap'",
  "Output: 'Build a login page using Vue 3 (latest stable) with Composition API, <script setup>, and TypeScript. Include email and password fields with client-side form validation and error states. [CLARIFY: Should I use a UI component library (Vuetify, PrimeVue, Element Plus) or build with plain CSS/Tailwind? Is there an existing auth API endpoint to integrate with?]'",
  "",
  "Input: 'add dark mode'",
  "Output: 'Add dark mode support with a toggle switch. Use CSS custom properties for theming. Persist the user preference in localStorage and respect the system prefers-color-scheme as the initial default.'",
  "",
  "Input: 'bu dosyadaki hatayı düzelt'",
  "Output: 'Fix the bug in this file. [CLARIFY: What is the specific error or unexpected behavior you are seeing? Describe the expected vs actual result.]'",
  "",
  "Input: 'react ile dashboard yap'",
  "Output: 'Build a dashboard using React 19+ with TypeScript, functional components, and hooks. Use a modern build tool (Vite). Structure components with clear separation of concerns. [CLARIFY: What data should the dashboard display? Should I use a charting library (Recharts, Chart.js)? Is there a preferred UI framework (shadcn/ui, Ant Design, MUI)?]'",
  "",
  "Input: 'API endpoint ekle kullanıcı silmek için'",
  "Output: 'Add a DELETE API endpoint for removing users. Include proper authentication/authorization checks, input validation, soft-delete vs hard-delete consideration, and appropriate HTTP status codes (204 on success, 404 if not found, 403 if unauthorized). [CLARIFY: Should this be a soft delete (mark as deleted) or a hard delete (permanent removal)?]'",
  "",
  "Input: 'evet, öyle yap'",
  "Output: 'Yes, do it that way.'",
].join("\n");

type MessagePart = {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type: string;
  text?: string;
  mime?: string;
  filename?: string;
  ignored?: boolean;
  synthetic?: boolean;
  metadata?: Record<string, unknown>;
};

type Message = {
  info?: { id?: string; role?: string; sessionID?: string };
  parts?: MessagePart[];
};

function unwrap<T>(result: unknown): T | undefined {
  return result && typeof result === "object" && "data" in result
    ? (result as Record<string, T>).data
    : (result as T | undefined);
}

function getTextParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter(
    (part) => part?.type === "text" && typeof part.text === "string",
  );
}

function describeNonTextParts(parts: MessagePart[]): string[] {
  const placeholders: string[] = [];
  for (const part of parts) {
    if (!part || part.type === "text") continue;
    if (part.type === "file") {
      const mime = part.mime ?? "";
      if (mime.startsWith("image/")) {
        placeholders.push("[image]");
      } else {
        const label = part.filename ?? mime ?? "file";
        placeholders.push(`\u00ABpasted ${label}\u00BB`);
      }
    }
  }
  return placeholders;
}

function buildRefineRequest(
  text: string,
  attachmentPlaceholders: string[],
): string {
  const lines = [
    "Enhance the user message inside <source_message> into a precise, actionable prompt for a coding AI assistant.",
    "Apply version precision, best practices, and CLARIFY markers per the system instructions.",
    "Output ONLY the enhanced prompt — no labels, no prefixes, no commentary.",
  ];

  if (attachmentPlaceholders.length > 0) {
    lines.push(
      "",
      "The user also attached: " + attachmentPlaceholders.join(", "),
      "Reference these attachments naturally in the enhanced prompt where they logically belong.",
    );
  }

  lines.push("", "<source_message>", text, "</source_message>");
  return lines.join("\n");
}

function extractText(parts: MessagePart[]): string {
  return parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => (part.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

const PLUGIN_NOISE_PATTERNS = [
  /^\u25a3\s/,
  /^\u2192\s/,
  /^\[(refined|enhanced) prompt\]/i,
  /^@\w+/,
  /tokens?\s+saved/i,
  /^Pruning\s*\(/i,
  /^Noise Removal/i,
  /^\[TodoContinuation\]/i,
];

function looksLikePluginMessage(text: string): boolean {
  return PLUGIN_NOISE_PATTERNS.some((re) => re.test(text.trim()));
}

function hasOnlyIgnoredOrSyntheticParts(parts: MessagePart[]): boolean {
  if (!parts || parts.length === 0) return true;
  return parts.every(
    (part) => part?.ignored === true || part?.synthetic === true,
  );
}

function shouldSkip(
  text: string,
  sessionID: string,
  parts: MessagePart[],
): boolean {
  if (!text) return true;
  if (internalSessionIDs.has(sessionID)) return true;
  if (/^\/\S+/.test(text)) return true;
  if (looksLikePluginMessage(text)) return true;
  if (hasOnlyIgnoredOrSyntheticParts(parts)) return true;
  return false;
}

function isUserMessage(message: Message): boolean {
  return message?.info?.role === "user";
}

function isAssistantMessage(message: Message): boolean {
  return message?.info?.role === "assistant";
}

/**
 * Strip `> **[refined prompt]** ...` prefixes from assistant messages
 * so the model never sees them in conversation history on subsequent turns.
 * The prefix is still rendered to the user via `experimental.text.complete`.
 */
function stripRefinedPromptFromHistory(messages: Message[]): void {
  for (const message of messages) {
    if (!isAssistantMessage(message) || !message.parts) continue;

    for (const part of message.parts) {
      if (part?.type !== "text" || typeof part.text !== "string") continue;
      if (
        !part.text.startsWith("> **[refined prompt]**") &&
        !part.text.startsWith("> **[enhanced prompt]**")
      )
        continue;

      const lines = part.text.split("\n");
      let i = 0;
      // Skip blockquote lines belonging to the [refined prompt] header
      while (i < lines.length && lines[i].startsWith(">")) {
        i++;
      }
      // Skip blank lines separating the header from the actual response
      while (i < lines.length && lines[i].trim() === "") {
        i++;
      }
      part.text = lines.slice(i).join("\n");
    }
  }
}

/**
 * Re-apply cached refinements to ALL user messages in the conversation.
 * The framework passes original (un-transformed) messages on every turn,
 * so without this step the model would see raw text from previous turns.
 */
function applyCachedRefinements(messages: Message[]): void {
  for (const message of messages) {
    if (!isUserMessage(message) || !message.parts) continue;
    if (isAlreadyRefined(message.parts)) continue;

    const text = extractText(getTextParts(message.parts));
    if (!text) continue;

    const fp = fingerprint(text);
    const cached = refinedTextCache.get(fp);
    if (cached && cached !== text) {
      message.parts = applyRewrite(message.parts, cached);
    }
  }
}

function isAlreadyRefined(parts: MessagePart[]): boolean {
  return parts?.some(
    (part) =>
      (part?.metadata as Record<string, unknown>)?.promptRefiner &&
      (
        (part.metadata as Record<string, unknown>).promptRefiner as Record<
          string,
          unknown
        >
      )?.refined,
  );
}

function applyRewrite(
  parts: MessagePart[],
  rewrittenText: string,
): MessagePart[] {
  let replaced = false;
  return parts.flatMap((part) => {
    if (part?.type !== "text") return [part];
    if (replaced) return [];
    replaced = true;
    return [
      {
        ...part,
        text: rewrittenText,
        metadata: {
          ...(part.metadata ?? {}),
          promptRefiner: { refined: true },
        },
      },
    ];
  });
}

function getLatestUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isUserMessage(messages[i])) return messages[i];
  }
  return undefined;
}

function parseModelSpec(
  spec: unknown,
): { providerID: string; modelID: string } | undefined {
  if (typeof spec !== "string") return undefined;
  const trimmed = spec.trim();
  if (!trimmed) return undefined;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) return undefined;

  return {
    providerID: trimmed.slice(0, slashIndex),
    modelID: trimmed.slice(slashIndex + 1),
  };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

async function getRuntimeSettings(
  client: PluginInput["client"],
  directory: string,
) {
  try {
    const config = unwrap<Record<string, unknown>>(
      await client.config.get({ query: { directory } }),
    );

    const agentConfig =
      ((config?.agent as Record<string, Record<string, unknown>>)?.[
        REFINER_AGENT_NAME
      ] as Record<string, unknown>) ?? {};
    const model =
      parseModelSpec(agentConfig.model) ??
      parseModelSpec(config?.small_model) ??
      parseModelSpec(DEFAULT_REFINER_MODEL);
    const systemPrompt =
      typeof agentConfig.prompt === "string" &&
      (agentConfig.prompt as string).trim()
        ? (agentConfig.prompt as string).trim()
        : DEFAULT_REWRITE_SYSTEM_PROMPT;
    const variant =
      typeof agentConfig.variant === "string" &&
      (agentConfig.variant as string).trim()
        ? (agentConfig.variant as string).trim()
        : undefined;

    return {
      disabled: normalizeBoolean(agentConfig.disable, false),
      visibleDebug: normalizeBoolean(agentConfig.visible_debug, true),
      model,
      variant,
      systemPrompt,
    };
  } catch {
    return {
      disabled: false,
      visibleDebug: true,
      model: parseModelSpec(DEFAULT_REFINER_MODEL),
      variant: undefined,
      systemPrompt: DEFAULT_REWRITE_SYSTEM_PROMPT,
    };
  }
}

async function log(
  client: PluginInput["client"],
  level: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  try {
    await client.app.log({
      body: {
        service: PLUGIN_SERVICE,
        level: level as "error" | "info" | "debug" | "warn",
        message,
        extra,
      },
    });
  } catch {
    // swallow
  }
}

export function createPromptRefinerHook(ctx: PluginInput) {
  const { client, directory } = ctx;

  return {
    "experimental.chat.messages.transform": async (
      _input: unknown,
      output: { messages?: Message[] },
    ) => {
      evictCacheIfNeeded();
      // 1. Strip [refined prompt] prefixes from assistant messages
      //    so the model never sees debug annotations in conversation history.
      stripRefinedPromptFromHistory(output.messages ?? []);

      // 2. Re-apply cached refinements to ALL previous user messages.
      //    The framework passes original texts each turn; without this
      //    the model would see un-refined messages from earlier turns.
      applyCachedRefinements(output.messages ?? []);

      const targetMessage = getLatestUserMessage(output.messages ?? []);
      const sessionID = targetMessage?.info?.sessionID;
      const originalText = extractText(
        getTextParts(targetMessage?.parts ?? []),
      );

      if (
        !targetMessage ||
        !sessionID ||
        shouldSkip(originalText, sessionID, targetMessage.parts ?? [])
      )
        return;
      if (isAlreadyRefined(targetMessage.parts ?? [])) return;

      // Fingerprint gate: only process genuinely new user messages.
      // Same text = same fingerprint = skip (handles re-renders, tool cycles, compaction).
      const fp = fingerprint(originalText);
      if (processedFingerprints.get(sessionID) === fp) return;
      processedFingerprints.set(sessionID, fp);

      const runtime = await getRuntimeSettings(client, directory);
      if (runtime.disabled) return;

      const attachmentPlaceholders = describeNonTextParts(
        targetMessage.parts ?? [],
      );
      let rewriteSessionID: string | undefined;

      try {
        const created = unwrap<{ id?: string }>(
          await client.session.create({
            body: { title: INTERNAL_SESSION_TITLE },
          }),
        );

        rewriteSessionID = created?.id;
        if (!rewriteSessionID) return;

        internalSessionIDs.add(rewriteSessionID);

        const promptBody = {
          model: runtime.model,
          system: runtime.systemPrompt,
          tools: {},
          parts: [
            {
              type: "text" as const,
              text: buildRefineRequest(originalText, attachmentPlaceholders),
            },
          ],
          ...(runtime.variant ? { variant: runtime.variant } : {}),
        };

        const response = unwrap<{ parts?: MessagePart[] }>(
          await client.session.prompt({
            path: { id: rewriteSessionID },
            body: promptBody as any,
          }),
        );

        const rewrittenText = extractText(response?.parts ?? []);
        if (!rewrittenText || rewrittenText === originalText) return;

        if (runtime.visibleDebug)
          pendingVisibleDebug.set(sessionID, rewrittenText);
        else pendingVisibleDebug.delete(sessionID);

        // Cache the refinement so it can be re-applied on future turns.
        refinedTextCache.set(fp, rewrittenText);

        targetMessage.parts = applyRewrite(
          targetMessage.parts ?? [],
          rewrittenText,
        );

        // Persist enhanced text to storage so pruning/summarize sees it
        // instead of the raw original (possibly non-English) text.
        // The v2 SDK exposes client.part.update(); the plugin type only
        // declares the v1 surface, so we access it via a safe cast.
        const messageID = targetMessage?.info?.id;
        const partClient = (client as any).part as
          | { update?: (...args: any[]) => Promise<any> }
          | undefined;

        if (messageID && partClient?.update) {
          for (const part of targetMessage.parts ?? []) {
            if (part?.type === "text" && part.id) {
              try {
                await partClient.update({
                  sessionID,
                  messageID,
                  partID: part.id,
                  part: {
                    id: part.id,
                    sessionID,
                    messageID,
                    type: "text",
                    text: part.text ?? "",
                    metadata: part.metadata,
                  },
                });
              } catch (persistError) {
                await log(
                  client,
                  "debug",
                  "Failed to persist enhanced text to storage",
                  {
                    sessionID,
                    messageID,
                    partID: part.id,
                    error:
                      persistError instanceof Error
                        ? persistError.message
                        : String(persistError),
                  },
                );
              }
            }
          }
        }
      } catch (error) {
        await log(client, "warn", "Prompt refinement failed", {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (rewriteSessionID) {
          internalSessionIDs.delete(rewriteSessionID);
          try {
            await client.session.delete({ path: { id: rewriteSessionID } });
          } catch {
            await log(
              client,
              "debug",
              "Failed to delete prompt refiner session",
              {
                sessionID: rewriteSessionID,
              },
            );
          }
        }
      }
    },

    "experimental.text.complete": async (
      input: { sessionID?: string },
      output: { text?: string },
    ) => {
      const rewrittenText = pendingVisibleDebug.get(input.sessionID ?? "");
      if (!rewrittenText || !output.text) return;

      pendingVisibleDebug.delete(input.sessionID ?? "");
      const quotedRewrite = rewrittenText
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      output.text = `> **[enhanced prompt]**\n${quotedRewrite}\n\n${output.text}`;
    },

    // Secondary defense: instruct the compaction model to never surface
    // original non-English text in case storage persistence was skipped.
    "experimental.session.compacting": async (
      _input: { sessionID: string },
      output: { context: string[]; prompt?: string },
    ) => {
      output.context.push(
        "IMPORTANT: All user messages have been enhanced and translated to English. " +
          "When summarizing, use ONLY the English text present in the messages. " +
          "Never include, reference, or reproduce any non-English original text.",
      );
    },
  };
}
