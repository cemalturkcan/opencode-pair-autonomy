import fs from "node:fs/promises";
import path from "node:path";
import type { WebAgentEnv } from "../config/env.js";
import {
  appendJsonLine,
  ensureDir,
  readJsonFile,
  writeJsonFile,
} from "../utils/fs.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export type ArtifactKind =
  | "a11y"
  | "dom"
  | "text"
  | "markdown"
  | "boxes"
  | "screenshot"
  | "console"
  | "network"
  | "eval";

export type ArtifactRecord = {
  artifact_id: string;
  session_id?: string;
  page_id?: string;
  task_id?: string;
  action_id?: string;
  kind: ArtifactKind;
  created_at: string;
  url?: string;
  title?: string;
  parent_artifact_id?: string;
  storage_path?: string;
  bytes?: number;
  meta?: Record<string, unknown>;
};

export class ArtifactStore {
  private readonly artifactPath: string;
  private readonly indexPath: string;
  private readonly rootDir: string;

  constructor(env: WebAgentEnv) {
    this.rootDir = env.artifactsDir;
    this.artifactPath = path.join(env.historyDir, "artifacts.jsonl");
    this.indexPath = path.join(env.artifactsDir, "index.json");
  }

  async writeText(
    kind: ArtifactKind,
    text: string,
    refs: Omit<
      ArtifactRecord,
      "artifact_id" | "created_at" | "kind" | "storage_path" | "bytes"
    > = {},
  ) {
    const artifactId = createId("artifact");
    const filePath = path.join(this.rootDir, `${artifactId}.txt`);
    await ensureDir(this.rootDir);
    await fs.writeFile(filePath, text, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    const record = await this.saveMetadata({
      artifact_id: artifactId,
      kind,
      created_at: nowIso(),
      storage_path: filePath,
      bytes,
      ...refs,
    });
    return record;
  }

  async writeBinary(
    kind: ArtifactKind,
    buffer: Buffer,
    extension: string,
    refs: Omit<
      ArtifactRecord,
      "artifact_id" | "created_at" | "kind" | "storage_path" | "bytes"
    > = {},
  ) {
    const artifactId = createId("artifact");
    const filePath = path.join(this.rootDir, `${artifactId}.${extension}`);
    await ensureDir(this.rootDir);
    await fs.writeFile(filePath, buffer);
    const record = await this.saveMetadata({
      artifact_id: artifactId,
      kind,
      created_at: nowIso(),
      storage_path: filePath,
      bytes: buffer.byteLength,
      ...refs,
    });
    return record;
  }

  private async saveMetadata(record: ArtifactRecord) {
    await appendJsonLine(this.artifactPath, record);
    const index = await readJsonFile<Record<string, ArtifactRecord>>(
      this.indexPath,
      {},
    );
    index[record.artifact_id] = record;
    await writeJsonFile(this.indexPath, index);
    return record;
  }
}
