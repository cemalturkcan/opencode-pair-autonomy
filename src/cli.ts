import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLE_PROJECT_CONFIG } from "./config";
import { installHarness, uninstallHarness } from "./installer";

function printHelp(): void {
  console.log(`opencode-pair-autonomy

Commands:
  init [directory]       Create .opencode/opencode-pair-autonomy.jsonc
  install                Install plugin stack into the active OpenCode config
  fresh-install          Delete non-config files, then reinstall the stack
  uninstall              Remove harness-managed wiring and keep user config files
  print-config           Print the snippet to add into opencode.json
`);
}

function initProject(directory?: string): void {
  const targetRoot = resolve(directory ?? process.cwd());
  const opencodeDir = join(targetRoot, ".opencode");
  const configPath = join(opencodeDir, "opencode-pair-autonomy.jsonc");

  if (!existsSync(opencodeDir)) {
    mkdirSync(opencodeDir, { recursive: true });
  }

  if (existsSync(configPath)) {
    console.log(`Already exists: ${configPath}`);
    return;
  }

  writeFileSync(configPath, `${SAMPLE_PROJECT_CONFIG}\n`, "utf8");
  console.log(`Created ${configPath}`);
}

function printConfig(): void {
  console.log(`{
  "plugin": [
    "file://<project-root>",
    "@zenobius/opencode-skillful@latest",
    "@franlol/opencode-md-table-formatter@latest",
    "opencode-pty@latest",
    "opencode-anthropic-login-via-cli@latest",
    "file://~/.config/opencode/vendor/opencode-background-agents-local"
  ],
  "instructions": [
    "~/.config/opencode/plugin/shell-strategy/shell_strategy.md"
  ],
  "default_agent": "pair"
}

Use \`opencode-pair-autonomy install\` for the real path-aware install.`);
}

export function main(argv: string[]): void {
  const [command, arg] = argv;
  const fresh = argv.includes("--fresh");

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    return;
  }

  if (command === "init") {
    initProject(arg);
    return;
  }

  if (command === "install") {
    installHarness({ fresh })
      .then((result) => {
        console.log(`Installed into ${result.configPath}`);
        console.log(`Updated package manifest ${result.packageJsonPath}`);
        console.log(`Harness config ready at ${result.harnessConfigPath}`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
    return;
  }

  if (command === "fresh-install") {
    installHarness({ fresh: true })
      .then((result) => {
        console.log(`Fresh-installed into ${result.configPath}`);
        console.log(`Updated package manifest ${result.packageJsonPath}`);
        console.log(`Harness config ready at ${result.harnessConfigPath}`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
    return;
  }

  if (command === "print-config") {
    printConfig();
    return;
  }

  if (command === "uninstall") {
    uninstallHarness()
      .then((result) => {
        console.log(`Uninstalled harness wiring from ${result.configPath}`);
        console.log(`Updated package manifest ${result.packageJsonPath}`);
        console.log(
          `Preserved user files: ${result.preservedPaths.join(", ")}`,
        );
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
    return;
  }

  printHelp();
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  return resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main(process.argv.slice(2));
}
