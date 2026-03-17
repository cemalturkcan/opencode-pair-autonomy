import {
  chmodSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { SAMPLE_PROJECT_CONFIG } from "./config";

type JsonRecord = Record<string, unknown>;

const STATIC_PLUGIN_FILENAMES = [
  "opencode-pair-autonomy.js",
  "opencode-dcp.js",
  "opencode-skillful.js",
  "opencode-notificator.js",
  "md-table-formatter.js",
  "opencode-pty.js",
] as const;

const MANAGED_PACKAGE_NAMES = [
  "opencode-pair-autonomy",
  "opencode-pty",
  "opencode-notificator",
  "@zenobius/opencode-skillful",
  "@tarquinen/opencode-dcp",
  "@franlol/opencode-md-table-formatter",
] as const;

const PACKAGE_SPECS: Record<string, string> = {
  "opencode-pty": "latest",
  "opencode-notificator":
    "git+https://github.com/panta82/opencode-notificator.git",
  "@zenobius/opencode-skillful": "latest",
  "@tarquinen/opencode-dcp": "latest",
  "@franlol/opencode-md-table-formatter": "latest",
  "unique-names-generator": "latest",
  "@modelcontextprotocol/sdk": "latest",
  pg: "latest",
  zod: "latest",
};

const MCP_NAMES = ["pg-mcp", "ssh-mcp", "sudo-mcp"] as const;

const BACKGROUND_AGENT_FILES = [
  "background-agents.ts",
  "kdco-primitives/get-project-id.ts",
  "kdco-primitives/index.ts",
  "kdco-primitives/log-warn.ts",
  "kdco-primitives/mutex.ts",
  "kdco-primitives/shell.ts",
  "kdco-primitives/temp.ts",
  "kdco-primitives/terminal-detect.ts",
  "kdco-primitives/types.ts",
  "kdco-primitives/with-timeout.ts",
] as const;

function getConfigDir(): string {
  const envDir = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (envDir) {
    return resolve(envDir);
  }
  return join(homedir(), ".config", "opencode");
}

function getConfigPaths(configDir: string) {
  return {
    configDir,
    binDir: join(configDir, "bin"),
    skillsDir: join(configDir, "skills"),
    configJson: join(configDir, "opencode.json"),
    configJsonc: join(configDir, "opencode.jsonc"),
    packageJson: join(configDir, "package.json"),
    harnessConfig: join(configDir, "opencode-pair-autonomy.jsonc"),
    dcpConfig: join(configDir, "dcp.jsonc"),
    vendorDir: join(configDir, "vendor", "opencode-background-agents-local"),
    vendorMcpDir: join(configDir, "vendor", "mcp"),
    shellStrategyDir: join(configDir, "plugin", "shell-strategy"),
    pluginsDir: join(configDir, "plugins"),
  };
}

function defaultConfigDir(): string {
  return join(homedir(), ".config", "opencode");
}

function bundledMcpSourceRoot(name: string): string {
  return join(packageRoot(), "vendor", "mcp", name);
}

function detectMainConfigPath(paths: ReturnType<typeof getConfigPaths>): {
  path: string;
  format: "json" | "jsonc";
} {
  if (existsSync(paths.configJson)) {
    return { path: paths.configJson, format: "json" };
  }
  if (existsSync(paths.configJsonc)) {
    return { path: paths.configJsonc, format: "jsonc" };
  }
  return { path: paths.configJson, format: "json" };
}

function readJsonLike(filePath: string): JsonRecord {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {};
  }

  const parsed = parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as JsonRecord;
}

function backupFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const backupPath = `${filePath}.bak.${Date.now()}`;
  copyFileSync(filePath, backupPath);
}

function writeJson(filePath: string, value: JsonRecord): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeJinaApiKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.toLowerCase().startsWith("bearer ")
    ? trimmed.slice(7).trim()
    : trimmed;
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function shouldPreserveFreshInstallEntry(
  configDir: string,
  entryName: string,
): boolean {
  const entryPath = join(configDir, entryName);
  if (!existsSync(entryPath)) {
    return false;
  }

  const stat = statSync(entryPath);
  if (!stat.isFile()) {
    return false;
  }

  if (entryName === "package.json") {
    return false;
  }

  return entryName.endsWith(".json") || entryName.endsWith(".jsonc");
}

function freshInstallCleanup(configDir: string): void {
  if (!existsSync(configDir)) {
    return;
  }

  for (const entry of readdirSync(configDir)) {
    if (shouldPreserveFreshInstallEntry(configDir, entry)) {
      continue;
    }

    rmSync(join(configDir, entry), { recursive: true, force: true });
  }
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function repositoryToPackageSpec(repository: unknown): string | undefined {
  const source =
    typeof repository === "string"
      ? repository
      : repository &&
          typeof repository === "object" &&
          !Array.isArray(repository) &&
          typeof (repository as JsonRecord).url === "string"
        ? String((repository as JsonRecord).url)
        : undefined;

  if (!source) {
    return undefined;
  }

  const trimmed = source.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("github:")) {
    return trimmed;
  }

  const match = trimmed.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (!match) {
    return undefined;
  }

  return `github:${match[1]}/${match[2]}`;
}

function resolveSelfPackageSpec(): string {
  const override = process.env.OPENCODE_PAIR_AUTONOMY_PACKAGE_SPEC?.trim();
  if (override) {
    return override;
  }

  const root = packageRoot();
  if (existsSync(join(root, ".git"))) {
    return `file:${root}`;
  }

  const metadata = readJsonLike(join(root, "package.json"));
  const repositorySpec = repositoryToPackageSpec(metadata.repository);
  if (repositorySpec) {
    return repositorySpec;
  }

  const version =
    typeof metadata.version === "string" ? metadata.version.trim() : "";
  return version || "latest";
}

function mergePluginList(
  existing: unknown,
  vendorDir: string,
  pluginsDir: string,
): string[] {
  const backgroundEntry = `file://${vendorDir}`;
  const desired = [
    ...STATIC_PLUGIN_FILENAMES.map(
      (file) => `file://${join(pluginsDir, file)}`,
    ),
    backgroundEntry,
  ];
  const current = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string")
    : [];
  const retained = current.filter(
    (item) =>
      !desired.includes(item) &&
      !item.includes("opencode-background-agents-local") &&
      !item.includes("plannotator") &&
      item !== "opencode-shell-non-interactive-strategy" &&
      item !== "opencode-pair-autonomy" &&
      item !== "@tarquinen/opencode-dcp",
  );
  return [...desired, ...retained];
}

function mergeInstructionsList(
  existing: unknown,
  shellStrategyDir: string,
): string[] {
  const shellInstruction = join(shellStrategyDir, "shell_strategy.md");
  const current = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string")
    : [];
  const retained = current.filter(
    (item) => !item.endsWith("/shell-strategy/shell_strategy.md"),
  );
  return [shellInstruction, ...retained];
}

function removeHarnessPluginList(
  existing: unknown,
  vendorDir: string,
  pluginsDir: string,
): string[] | undefined {
  const managedEntries = new Set([
    ...STATIC_PLUGIN_FILENAMES.map(
      (file) => `file://${join(pluginsDir, file)}`,
    ),
    `file://${vendorDir}`,
    "opencode-pair-autonomy",
    "@tarquinen/opencode-dcp",
  ]);
  const current = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string")
    : [];
  const retained = current.filter((item) => !managedEntries.has(item));
  return retained.length > 0 ? retained : undefined;
}

function removeHarnessInstructionsList(
  existing: unknown,
): string[] | undefined {
  const current = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string")
    : [];
  const retained = current.filter(
    (item) => !item.endsWith("/shell-strategy/shell_strategy.md"),
  );
  return retained.length > 0 ? retained : undefined;
}

function normalizePermissionAction(
  value: unknown,
): "allow" | "ask" | "deny" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  switch (value.trim().toLowerCase()) {
    case "allow":
    case "always":
      return "allow";
    case "ask":
    case "prompt":
      return "ask";
    case "deny":
    case "block":
    case "never":
      return "deny";
    default:
      return undefined;
  }
}

function normalizePermissionValue(value: unknown): unknown {
  const action = normalizePermissionAction(value);
  if (action) {
    return action;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalized: JsonRecord = {};
  for (const [key, nested] of Object.entries(value as JsonRecord)) {
    const next = normalizePermissionValue(nested);
    if (next !== undefined) {
      normalized[key] = next;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeLegacyRuleset(config: JsonRecord): void {
  if (!("ruleset" in config)) {
    return;
  }

  const normalized = normalizePermissionValue(config.ruleset);
  delete config.ruleset;

  if (normalized !== undefined && config.permission === undefined) {
    config.permission = normalized;
  }
}

function forceAllowPermissions(config: JsonRecord): void {
  normalizeLegacyRuleset(config);
  config.permission = "allow";
}

function writeHarnessConfig(filePath: string, jinaApiKey?: string): void {
  const current = existsSync(filePath) ? readJsonLike(filePath) : {};
  const next = parse(SAMPLE_PROJECT_CONFIG) as JsonRecord;
  const merged: JsonRecord = {
    ...next,
    ...current,
    hooks: {
      ...((next.hooks as JsonRecord | undefined) ?? {}),
      ...((current.hooks as JsonRecord | undefined) ?? {}),
    },
    mcps: {
      ...((next.mcps as JsonRecord | undefined) ?? {}),
      ...((current.mcps as JsonRecord | undefined) ?? {}),
    },
    agents: {
      ...((next.agents as JsonRecord | undefined) ?? {}),
      ...((current.agents as JsonRecord | undefined) ?? {}),
    },
    credentials: {
      ...((next.credentials as JsonRecord | undefined) ?? {}),
      ...((current.credentials as JsonRecord | undefined) ?? {}),
    },
  };

  if (jinaApiKey) {
    (merged.credentials as JsonRecord).jina_api_key = jinaApiKey;
  }

  writeJson(filePath, merged);
}

const DEFAULT_DCP_CONFIG: JsonRecord = {
  $schema:
    "https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json",
  compress: {
    nudgeFrequency: 10,
    iterationNudgeThreshold: 25,
    nudgeForce: "soft",
  },
};

function writeDcpConfig(filePath: string): void {
  const current = existsSync(filePath) ? readJsonLike(filePath) : {};
  const merged: JsonRecord = {
    ...DEFAULT_DCP_CONFIG,
    ...current,
    compress: {
      ...((DEFAULT_DCP_CONFIG.compress as JsonRecord | undefined) ?? {}),
      ...((current.compress as JsonRecord | undefined) ?? {}),
    },
  };
  writeJson(filePath, merged);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return await response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

function resolveFffReleaseTarget(): string | undefined {
  if (process.platform === "linux" && process.arch === "x64") {
    return "x86_64-unknown-linux-musl";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "aarch64-unknown-linux-musl";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "x86_64-apple-darwin";
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc.exe";
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return "aarch64-pc-windows-msvc.exe";
  }
  return undefined;
}

async function installFffMcp(binDir: string): Promise<void> {
  const target = resolveFffReleaseTarget();
  if (!target) {
    console.warn(
      `[opencode-pair-autonomy] Skipping fff-mcp install: unsupported platform ${process.platform}/${process.arch}`,
    );
    return;
  }

  const release = await fetchJson<{
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  }>("https://api.github.com/repos/dmtrKovalenko/fff.nvim/releases/latest");
  const expectedName =
    process.platform === "win32" ? `fff-mcp-${target}` : `fff-mcp-${target}`;
  const asset = release.assets?.find(
    (entry) =>
      entry.name === expectedName &&
      typeof entry.browser_download_url === "string",
  );

  if (!asset?.browser_download_url) {
    throw new Error(
      `Could not find a matching fff-mcp release asset for target ${target}`,
    );
  }

  const response = await fetch(asset.browser_download_url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${asset.browser_download_url}: ${response.status}`,
    );
  }

  const outputPath = join(
    binDir,
    process.platform === "win32" ? "fff-mcp.exe" : "fff-mcp",
  );
  ensureDir(binDir);
  writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
  if (process.platform !== "win32") {
    chmodSync(outputPath, 0o755);
  }
}

async function installBackgroundAgentsVendor(vendorDir: string): Promise<void> {
  ensureDir(join(vendorDir, "kdco-primitives"));

  for (const relativePath of BACKGROUND_AGENT_FILES) {
    const url = `https://raw.githubusercontent.com/kdcokenny/opencode-background-agents/main/src/plugin/${relativePath}`;
    const targetPath = join(vendorDir, relativePath);
    ensureDir(dirname(targetPath));
    const content = await fetchText(url);
    writeFileSync(targetPath, content, "utf8");
  }

  const packageJson: JsonRecord = {
    name: "opencode-background-agents-local",
    version: "0.1.0",
    private: true,
    type: "module",
    module: "background-agents.ts",
    main: "background-agents.ts",
    dependencies: {
      "@opencode-ai/plugin": "latest",
      "@opencode-ai/sdk": "latest",
      "unique-names-generator": "latest",
    },
  };

  writeJson(join(vendorDir, "package.json"), packageJson);
}

async function installShellStrategyInstruction(
  shellStrategyDir: string,
): Promise<void> {
  ensureDir(shellStrategyDir);
  const content = await fetchText(
    "https://raw.githubusercontent.com/JRedeker/opencode-shell-strategy/trunk/shell_strategy.md",
  );
  writeFileSync(join(shellStrategyDir, "shell_strategy.md"), content, "utf8");
}

function installPluginWrappers(pluginsDir: string, configDir: string): void {
  ensureDir(pluginsDir);
  writeFileSync(
    join(pluginsDir, "opencode-pair-autonomy.js"),
    `import plugin from "file://${join(configDir, "node_modules", "opencode-pair-autonomy", "dist", "index.js")}";\nexport default plugin;\n`,
    "utf8",
  );
  writeFileSync(
    join(pluginsDir, "opencode-dcp.js"),
    `import plugin from "file://${join(configDir, "node_modules", "@tarquinen", "opencode-dcp", "dist", "index.js")}";\nexport default plugin;\n`,
    "utf8",
  );
  writeFileSync(
    join(pluginsDir, "opencode-skillful.js"),
    `import { SkillsPlugin } from "file://${join(configDir, "node_modules", "@zenobius", "opencode-skillful", "dist", "index.js")}";\nexport default SkillsPlugin;\n`,
    "utf8",
  );
  writeFileSync(
    join(pluginsDir, "opencode-notificator.js"),
    `import { NotificationPlugin } from "file://${join(configDir, "node_modules", "opencode-notificator", "notificator.js")}";\nexport default NotificationPlugin;\n`,
    "utf8",
  );
  writeFileSync(
    join(pluginsDir, "md-table-formatter.js"),
    `import { FormatTables } from "file://${join(configDir, "node_modules", "@franlol", "opencode-md-table-formatter", "index.ts")}";\nexport default FormatTables;\n`,
    "utf8",
  );
  writeFileSync(
    join(pluginsDir, "opencode-pty.js"),
    `import { PTYPlugin } from "file://${join(configDir, "node_modules", "opencode-pty", "src", "plugin.ts")}";\nexport default PTYPlugin;\n`,
    "utf8",
  );
}

function removePluginWrappers(pluginsDir: string): void {
  for (const filename of STATIC_PLUGIN_FILENAMES) {
    rmSync(join(pluginsDir, filename), { force: true });
  }
}

function copyDirectoryContents(
  sourceDir: string,
  targetDir: string,
  options?: {
    overwrite?: (relativePath: string, targetPath: string) => boolean;
  },
  relativePath = "",
): void {
  ensureDir(targetDir);

  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const nextRelativePath = relativePath ? join(relativePath, entry) : entry;
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath, options, nextRelativePath);
      continue;
    }

    if (
      options?.overwrite &&
      !options.overwrite(nextRelativePath, targetPath)
    ) {
      continue;
    }

    copyFileSync(sourcePath, targetPath);
  }
}

function shouldOverwriteBundledMcpFile(
  relativePath: string,
  targetPath: string,
  fresh = false,
): boolean {
  if (fresh) {
    return true;
  }

  return !(relativePath === "config.json" && existsSync(targetPath));
}

function installSelfContainedMcps(
  vendorMcpDir: string,
  options?: { fresh?: boolean },
): void {
  ensureDir(vendorMcpDir);

  for (const name of MCP_NAMES) {
    const sourceRoot = bundledMcpSourceRoot(name);
    if (!existsSync(sourceRoot)) {
      throw new Error(`Missing MCP source directory: ${sourceRoot}`);
    }

    const targetRoot = join(vendorMcpDir, name);
    ensureDir(targetRoot);
    copyDirectoryContents(sourceRoot, targetRoot, {
      overwrite: (relativePath, targetPath) =>
        shouldOverwriteBundledMcpFile(relativePath, targetPath, options?.fresh),
    });
  }
}

function bundledSkillsSourceRoot(): string {
  return join(packageRoot(), "vendor", "skills");
}

function installBundledSkills(skillsDir: string): void {
  const sourceRoot = bundledSkillsSourceRoot();
  if (!existsSync(sourceRoot)) {
    return;
  }

  ensureDir(skillsDir);
  copyDirectoryContents(sourceRoot, skillsDir);
}

function readExistingJinaApiKey(harnessConfigPath: string): string | undefined {
  const existingHarness = readJsonLike(harnessConfigPath);
  const harnessKey = normalizeJinaApiKey(
    (existingHarness.credentials as JsonRecord | undefined)?.jina_api_key as
      | string
      | undefined,
  );
  if (harnessKey) {
    return harnessKey;
  }

  const currentConfig = readJsonLike(
    detectMainConfigPath(getConfigPaths(getConfigDir())).path,
  );
  const bearer = (
    (currentConfig.mcp as JsonRecord | undefined)?.jina as
      | JsonRecord
      | undefined
  )?.headers as JsonRecord | undefined;
  return normalizeJinaApiKey(bearer?.Authorization as string | undefined);
}

async function promptForJinaApiKey(
  existing?: string,
): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return existing;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = existing ? " (press Enter to reuse existing value)" : "";
    const answer = await new Promise<string>(
      (resolveQuestion, rejectQuestion) => {
        rl.question(`Enter Jina API key${suffix}: `, (value) =>
          resolveQuestion(value),
        );
        rl.once("error", rejectQuestion);
      },
    );
    const normalized = normalizeJinaApiKey(answer);
    return normalized ?? existing;
  } finally {
    rl.close();
  }
}

function updateConfig(paths: ReturnType<typeof getConfigPaths>): string {
  const detected = detectMainConfigPath(paths);
  const config = readJsonLike(detected.path);
  backupFile(detected.path);
  config.$schema = config.$schema ?? "https://opencode.ai/config.json";
  config.plugin = mergePluginList(
    config.plugin,
    paths.vendorDir,
    paths.pluginsDir,
  );
  config.instructions = mergeInstructionsList(
    config.instructions,
    paths.shellStrategyDir,
  );
  config.default_agent = "pair";
  forceAllowPermissions(config);
  writeJson(detected.path, config);
  return detected.path;
}

function updatePackageJson(paths: ReturnType<typeof getConfigPaths>): string {
  const pkg = readJsonLike(paths.packageJson);
  backupFile(paths.packageJson);

  const dependencies =
    pkg.dependencies &&
    typeof pkg.dependencies === "object" &&
    !Array.isArray(pkg.dependencies)
      ? { ...(pkg.dependencies as Record<string, string>) }
      : {};

  for (const [name, spec] of Object.entries(PACKAGE_SPECS)) {
    dependencies[name] = spec;
  }

  dependencies["opencode-pair-autonomy"] = resolveSelfPackageSpec();
  delete dependencies["opencode-background-agents-local"];
  delete dependencies["opencode-shell-non-interactive-strategy"];

  pkg.dependencies = dependencies;
  writeJson(paths.packageJson, pkg);
  return paths.packageJson;
}

function ensureTuiConfig(configDir: string): void {
  const tuiPath = join(configDir, "tui.json");
  if (existsSync(tuiPath)) {
    return;
  }

  writeJson(tuiPath, {
    $schema: "https://opencode.ai/tui.json",
    theme: "system",
  });
}

function ensureSkillsDir(skillsDir: string): void {
  ensureDir(skillsDir);
}

function removeDirectoryIfEmpty(dirPath: string): void {
  if (!existsSync(dirPath)) {
    return;
  }

  const stat = statSync(dirPath);
  if (!stat.isDirectory()) {
    return;
  }

  if (readdirSync(dirPath).length > 0) {
    return;
  }

  rmSync(dirPath, { recursive: true, force: true });
}

async function runBunInstall(configDir: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["install"], {
      cwd: configDir,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`bun install failed with exit code ${code ?? -1}`),
      );
    });
  });
}

async function ensureInstalledHarnessBuild(configDir: string): Promise<void> {
  const packageDir = join(configDir, "node_modules", "opencode-pair-autonomy");
  const builtEntry = join(packageDir, "dist", "index.js");
  const sourceEntry = join(packageDir, "src", "index.ts");

  if (existsSync(builtEntry) || !existsSync(sourceEntry)) {
    return;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["run", "build"], {
      cwd: packageDir,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `bun run build failed for opencode-pair-autonomy with exit code ${code ?? -1}`,
        ),
      );
    });
  });
}

export async function installHarness(options?: { fresh?: boolean }): Promise<{
  configPath: string;
  packageJsonPath: string;
  harnessConfigPath: string;
}> {
  const configDir = getConfigDir();
  const paths = getConfigPaths(configDir);

  if (options?.fresh) {
    freshInstallCleanup(configDir);
  }

  ensureDir(configDir);
  ensureDir(paths.binDir);
  ensureDir(join(configDir, "vendor"));
  ensureTuiConfig(configDir);
  ensureSkillsDir(paths.skillsDir);

  const jinaApiKey = await promptForJinaApiKey(
    readExistingJinaApiKey(paths.harnessConfig),
  );
  await installShellStrategyInstruction(paths.shellStrategyDir);
  await installBackgroundAgentsVendor(paths.vendorDir);
  try {
    await installFffMcp(paths.binDir);
  } catch (error) {
    console.warn(
      `[opencode-pair-autonomy] Failed to install fff-mcp automatically: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  installSelfContainedMcps(paths.vendorMcpDir, { fresh: options?.fresh });
  installBundledSkills(paths.skillsDir);
  const configPath = updateConfig(paths);
  const packageJsonPath = updatePackageJson(paths);
  writeHarnessConfig(paths.harnessConfig, jinaApiKey);
  writeDcpConfig(paths.dcpConfig);
  await runBunInstall(configDir);
  await ensureInstalledHarnessBuild(configDir);
  installPluginWrappers(paths.pluginsDir, configDir);

  return {
    configPath,
    packageJsonPath,
    harnessConfigPath: paths.harnessConfig,
  };
}

export async function uninstallHarness(): Promise<{
  configPath: string;
  packageJsonPath: string;
  preservedPaths: string[];
}> {
  const configDir = getConfigDir();
  const paths = getConfigPaths(configDir);
  const detected = detectMainConfigPath(paths);

  if (existsSync(detected.path)) {
    const config = readJsonLike(detected.path);
    backupFile(detected.path);

    const nextPlugin = removeHarnessPluginList(
      config.plugin,
      paths.vendorDir,
      paths.pluginsDir,
    );
    if (nextPlugin) {
      config.plugin = nextPlugin;
    } else {
      delete config.plugin;
    }

    const nextInstructions = removeHarnessInstructionsList(config.instructions);
    if (nextInstructions) {
      config.instructions = nextInstructions;
    } else {
      delete config.instructions;
    }

    writeJson(detected.path, config);
  }

  if (existsSync(paths.packageJson)) {
    const pkg = readJsonLike(paths.packageJson);
    const currentDependencies =
      pkg.dependencies &&
      typeof pkg.dependencies === "object" &&
      !Array.isArray(pkg.dependencies)
        ? { ...(pkg.dependencies as Record<string, string>) }
        : undefined;

    if (currentDependencies) {
      backupFile(paths.packageJson);
      for (const packageName of MANAGED_PACKAGE_NAMES) {
        delete currentDependencies[packageName];
      }

      if (Object.keys(currentDependencies).length > 0) {
        pkg.dependencies = currentDependencies;
      } else {
        delete pkg.dependencies;
      }

      writeJson(paths.packageJson, pkg);
      await runBunInstall(configDir);
    }
  }

  removePluginWrappers(paths.pluginsDir);
  rmSync(join(paths.binDir, "fff-mcp"), { force: true });
  rmSync(join(paths.binDir, "fff-mcp.exe"), { force: true });
  rmSync(paths.vendorDir, { recursive: true, force: true });
  rmSync(join(paths.shellStrategyDir, "shell_strategy.md"), { force: true });

  removeDirectoryIfEmpty(paths.pluginsDir);
  removeDirectoryIfEmpty(paths.binDir);
  removeDirectoryIfEmpty(paths.shellStrategyDir);
  removeDirectoryIfEmpty(join(configDir, "plugin"));

  return {
    configPath: detected.path,
    packageJsonPath: paths.packageJson,
    preservedPaths: [paths.harnessConfig, paths.vendorMcpDir, paths.skillsDir],
  };
}
