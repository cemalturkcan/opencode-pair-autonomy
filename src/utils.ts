import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) {
    return (override === undefined ? base : override) as T;
  }

  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      continue;
    const current = result[key];
    if (isObject(current) && isObject(value)) {
      result[key] = deepMerge(current, value);
      continue;
    }
    result[key] = value;
  }

  return result as T;
}

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readText(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}
