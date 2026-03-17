import path from "node:path";
import type { WebAgentEnv } from "../config/env.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";
import { appendJsonLine } from "../utils/fs.js";

export type TaskRecord = {
  task_id: string;
  kind: string;
  status: "started" | "succeeded" | "failed";
  created_at: string;
  ended_at?: string;
  session_id?: string;
  page_id?: string;
  summary?: Record<string, unknown>;
};

export type ActionRecord = {
  action_id: string;
  task_id?: string;
  session_id?: string;
  page_id?: string;
  kind: string;
  status: "started" | "succeeded" | "failed";
  started_at: string;
  ended_at?: string;
  input_summary?: Record<string, unknown>;
  result_summary?: Record<string, unknown>;
  error_code?: string;
};

export class TaskHistoryStore {
  private readonly taskPath: string;
  private readonly actionPath: string;

  constructor(env: WebAgentEnv) {
    this.taskPath = path.join(env.historyDir, "tasks.jsonl");
    this.actionPath = path.join(env.historyDir, "actions.jsonl");
  }

  async startTask(kind: string, summary?: Record<string, unknown>) {
    const task: TaskRecord = {
      task_id: createId("task"),
      kind,
      status: "started",
      created_at: nowIso(),
      summary,
    };
    await appendJsonLine(this.taskPath, task);
    return task;
  }

  async finishTask(
    task: TaskRecord,
    status: "succeeded" | "failed",
    summary?: Record<string, unknown>,
  ) {
    await appendJsonLine(this.taskPath, {
      ...task,
      status,
      ended_at: nowIso(),
      summary: summary ?? task.summary,
    });
  }

  async startAction(
    kind: string,
    inputSummary?: Record<string, unknown>,
    refs?: Partial<ActionRecord>,
  ) {
    const action: ActionRecord = {
      action_id: createId("action"),
      kind,
      status: "started",
      started_at: nowIso(),
      input_summary: inputSummary,
      ...refs,
    };
    await appendJsonLine(this.actionPath, action);
    return action;
  }

  async finishAction(
    action: ActionRecord,
    status: "succeeded" | "failed",
    resultSummary?: Record<string, unknown>,
    errorCode?: string,
  ) {
    await appendJsonLine(this.actionPath, {
      ...action,
      status,
      ended_at: nowIso(),
      result_summary: resultSummary,
      error_code: errorCode,
    });
  }
}
