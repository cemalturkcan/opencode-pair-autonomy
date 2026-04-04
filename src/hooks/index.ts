import type { PluginInput } from "@opencode-ai/plugin";
import type { HarnessConfig } from "../types";
import { createCommentGuardHook } from "./comment-guard";
import { createFileEditedHook } from "./file-edited";
import { createPostToolUseHook } from "./post-tool-use";
import { createPreCompactHook } from "./pre-compact";
import { createPreToolUseHook } from "./pre-tool-use";
import { createHookRuntime, resolveHookProfile } from "./runtime";
import { safeCreateHook, safeHook } from "./sdk";
import { createSessionEndHook } from "./session-end";
import { createSessionStartHook } from "./session-start";
import { createStopHook } from "./stop";

type HookRecord = {
  config?: (config: any) => Promise<void>;
  "chat.message"?: (input: any, output: any) => Promise<void>;
  "chat.headers"?: (input: any, output: any) => Promise<void>;
  event?: (input: {
    event: { type: string; properties?: unknown };
  }) => Promise<void>;
  "tool.execute.before"?: (input: any) => Promise<void>;
  "tool.execute.after"?: (input: any, output: any) => Promise<void>;
  "file.edited"?: (input: any) => Promise<void>;
  "session.created"?: (input?: any) => Promise<void>;
  "session.idle"?: (input?: any) => Promise<void>;
  "session.deleted"?: (input?: any) => Promise<void>;
  "experimental.session.compacting"?: (input?: any) => Promise<void>;
  "experimental.chat.messages.transform"?: (
    input: any,
    output: any,
  ) => Promise<void>;
  "experimental.text.complete"?: (input: any, output: any) => Promise<void>;
};

function wrapHookRecord(
  name: string,
  hook: HookRecord | undefined,
): HookRecord | undefined {
  if (!hook) {
    return undefined;
  }

  return {
    config: safeHook(`${name}.config`, hook.config),
    "chat.message": safeHook(`${name}.chat.message`, hook["chat.message"]),
    "chat.headers": safeHook(`${name}.chat.headers`, hook["chat.headers"]),
    event: safeHook(`${name}.event`, hook.event),
    "tool.execute.before": safeHook(
      `${name}.tool.execute.before`,
      hook["tool.execute.before"],
    ),
    "tool.execute.after": safeHook(
      `${name}.tool.execute.after`,
      hook["tool.execute.after"],
    ),
    "file.edited": safeHook(`${name}.file.edited`, hook["file.edited"]),
    "session.created": safeHook(
      `${name}.session.created`,
      hook["session.created"],
    ),
    "session.idle": safeHook(`${name}.session.idle`, hook["session.idle"]),
    "session.deleted": safeHook(
      `${name}.session.deleted`,
      hook["session.deleted"],
    ),
    "experimental.session.compacting": safeHook(
      `${name}.experimental.session.compacting`,
      hook["experimental.session.compacting"],
    ),
    "experimental.chat.messages.transform": safeHook(
      `${name}.experimental.chat.messages.transform`,
      hook["experimental.chat.messages.transform"],
    ),
    "experimental.text.complete": safeHook(
      `${name}.experimental.text.complete`,
      hook["experimental.text.complete"],
    ),
  };
}

function composeChatMessage(hooks: HookRecord[]) {
  const active = hooks.map((hook) => hook["chat.message"]).filter(Boolean);
  if (active.length === 0) {
    return undefined;
  }

  return async (input: any, output: any) => {
    for (const hook of active) {
      await hook?.(input, output);
    }
  };
}

function composeConfig(hooks: HookRecord[]) {
  const active = hooks.map((hook) => hook.config).filter(Boolean);
  if (active.length === 0) {
    return undefined;
  }

  return async (config: any) => {
    for (const hook of active) {
      await hook?.(config);
    }
  };
}

function composeEvent(hooks: HookRecord[]) {
  const active = hooks.map((hook) => hook.event).filter(Boolean);
  if (active.length === 0) {
    return undefined;
  }

  return async (input: { event: { type: string; properties?: unknown } }) => {
    for (const hook of active) {
      await hook?.(input);
    }
  };
}

function composeToolAfter(hooks: HookRecord[]) {
  const active = hooks
    .map((hook) => hook["tool.execute.after"])
    .filter(Boolean);
  if (active.length === 0) {
    return undefined;
  }

  return async (input: any, output: any) => {
    for (const hook of active) {
      await hook?.(input, output);
    }
  };
}

function composeToolBefore(hooks: HookRecord[]) {
  const active = hooks
    .map((hook) => hook["tool.execute.before"])
    .filter(Boolean);
  if (active.length === 0) {
    return undefined;
  }

  return async (input: any) => {
    for (const hook of active) {
      await hook?.(input);
    }
  };
}

function composeSingleArg(hooks: HookRecord[], key: keyof HookRecord) {
  const active = hooks.map((hook) => hook[key]).filter(Boolean) as Array<
    (input: any) => Promise<void>
  >;
  if (active.length === 0) {
    return undefined;
  }

  return async (input: any) => {
    for (const hook of active) {
      await hook(input);
    }
  };
}

export async function createHarnessHooks(
  ctx: PluginInput,
  config: HarnessConfig,
) {
  const hooks: HookRecord[] = [];
  const profile = resolveHookProfile(config);
  const runtime = createHookRuntime(ctx, config);

  const registerHook = (
    name: string,
    enabled: boolean,
    factory: () => HookRecord,
  ) => {
    if (!enabled) {
      return;
    }

    const hook = wrapHookRecord(name, safeCreateHook(name, factory));
    if (hook) {
      hooks.push(hook);
    }
  };

  registerHook("comment_guard", config.hooks?.comment_guard !== false, () =>
    createCommentGuardHook(),
  );
  registerHook("session_start", config.hooks?.session_start !== false, () =>
    createSessionStartHook(ctx, config, runtime),
  );
  registerHook("pre_tool_use", config.hooks?.pre_tool_use !== false, () =>
    createPreToolUseHook(config, runtime, profile),
  );
  registerHook("post_tool_use", config.hooks?.post_tool_use !== false, () =>
    createPostToolUseHook(config, runtime, profile),
  );
  registerHook("pre_compact", config.hooks?.pre_compact !== false, () =>
    createPreCompactHook(runtime),
  );
  registerHook("stop", config.hooks?.stop !== false, () =>
    createStopHook(ctx, runtime),
  );
  registerHook("session_end", config.hooks?.session_end !== false, () =>
    createSessionEndHook(runtime),
  );
  registerHook("file_edited", config.hooks?.file_edited !== false, () =>
    createFileEditedHook(runtime),
  );

  return {
    config: composeConfig(hooks),
    "chat.message": composeChatMessage(hooks),
    "chat.headers": undefined,
    event: composeEvent(hooks),
    "tool.execute.before": composeToolBefore(hooks),
    "tool.execute.after": composeToolAfter(hooks),
    "file.edited": composeSingleArg(hooks, "file.edited"),
    "session.created": composeSingleArg(hooks, "session.created"),
    "session.idle": composeSingleArg(hooks, "session.idle"),
    "session.deleted": composeSingleArg(hooks, "session.deleted"),
    "experimental.session.compacting": composeSingleArg(
      hooks,
      "experimental.session.compacting",
    ),
    "experimental.chat.messages.transform": undefined,
    "experimental.text.complete": undefined,
  };
}
