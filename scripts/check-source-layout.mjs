import { readdir } from "node:fs/promises";

const roots = [
  {
    path: "src/client",
    allowedFiles: new Set(["main.tsx"]),
    requiredDirectories: ["features", "shared", "styles"]
  },
  {
    path: "src/server",
    allowedFiles: new Set(["index.ts", "cli.ts"]),
    requiredDirectories: ["analysis", "application", "auth", "config", "http", "media", "persistence", "shared"]
  }
];

const errors = [];

for (const root of roots) {
  const entries = await readdir(root.path, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));

  for (const directory of root.requiredDirectories) {
    if (!names.has(directory)) errors.push(`${root.path}/${directory} is missing`);
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue;
    if (!root.allowedFiles.has(entry.name)) {
      errors.push(`${root.path}/${entry.name} should live in a feature or layer directory`);
    }
  }
}

if (errors.length > 0) {
  console.error("Source layout check failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Source layout check passed.");
