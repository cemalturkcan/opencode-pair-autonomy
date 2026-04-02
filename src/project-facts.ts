import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectFacts = {
  packageManager: string;
  languages: string[];
  frameworks: string[];
};

type Detector = {
  id: string;
  matches: (directory: string, dependencies: Set<string>) => boolean;
};

const PROJECT_FACT_LABELS = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  go: "Go",
  rust: "Rust",
  python: "Python",
  nextjs: "Next.js",
  react: "React",
  vue: "Vue",
  vite: "Vite",
  "vite-vue": "Vite/Vue",
  angular: "Angular",
  svelte: "Svelte",
} as const;

function readPackageDependencies(directory: string): Set<string> {
  const packageJsonPath = join(directory, "package.json");
  if (!existsSync(packageJsonPath)) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function detectPackageManager(directory: string): string {
  if (
    existsSync(join(directory, "bun.lockb")) ||
    existsSync(join(directory, "bun.lock"))
  ) {
    return "bun";
  }
  if (existsSync(join(directory, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(directory, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(directory, "package-lock.json"))) {
    return "npm";
  }
  return "unknown";
}

const LANGUAGE_DETECTORS: Detector[] = [
  {
    id: "typescript",
    matches: (directory, dependencies) =>
      existsSync(join(directory, "tsconfig.json")) ||
      dependencies.has("typescript"),
  },
  {
    id: "javascript",
    matches: (directory) => existsSync(join(directory, "package.json")),
  },
  { id: "go", matches: (directory) => existsSync(join(directory, "go.mod")) },
  {
    id: "rust",
    matches: (directory) => existsSync(join(directory, "Cargo.toml")),
  },
  {
    id: "python",
    matches: (directory) =>
      existsSync(join(directory, "pyproject.toml")) ||
      existsSync(join(directory, "requirements.txt")),
  },
];

const FRAMEWORK_DETECTORS: Detector[] = [
  {
    id: "nextjs",
    matches: (directory, dependencies) =>
      dependencies.has("next") ||
      existsSync(join(directory, "next.config.js")) ||
      existsSync(join(directory, "next.config.ts")),
  },
  {
    id: "react",
    matches: (_directory, dependencies) => dependencies.has("react"),
  },
  {
    id: "vue",
    matches: (_directory, dependencies) => dependencies.has("vue"),
  },
  {
    id: "vite",
    matches: (directory, dependencies) =>
      dependencies.has("vite") ||
      existsSync(join(directory, "vite.config.ts")) ||
      existsSync(join(directory, "vite.config.js")),
  },
  {
    id: "angular",
    matches: (_directory, dependencies) => dependencies.has("@angular/core"),
  },
  {
    id: "svelte",
    matches: (_directory, dependencies) => dependencies.has("svelte"),
  },
];

export function detectProjectFacts(directory: string): ProjectFacts {
  const dependencies = readPackageDependencies(directory);
  return {
    packageManager: detectPackageManager(directory),
    languages: LANGUAGE_DETECTORS.filter((detector) =>
      detector.matches(directory, dependencies),
    ).map((detector) => detector.id),
    frameworks: FRAMEWORK_DETECTORS.filter((detector) =>
      detector.matches(directory, dependencies),
    ).map((detector) => detector.id),
  };
}

export function getProjectFactLabel(id: string): string {
  return PROJECT_FACT_LABELS[id as keyof typeof PROJECT_FACT_LABELS] ?? id;
}

export function joinProjectFactLabels(ids: string[]): string {
  return ids.length > 0
    ? ids.map((id) => getProjectFactLabel(id)).join(", ")
    : "none detected";
}
