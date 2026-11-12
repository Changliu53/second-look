/**
 * Decides which changed files are not worth sending to the model: lockfiles,
 * generated output, and binaries. They cost tokens and produce noise.
 */

export type SkipReason = "lockfile" | "generated" | "binary";

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
]);

// Skipped wherever they appear in the path.
const GENERATED_DIRECTORIES = [
  "node_modules/",
  "dist/",
  ".next/",
  "vendor/",
  "coverage/",
  "__snapshots__/",
];

// Skipped only at the repository root. Nested folders with these names are
// often real source code (for example src/build/).
const GENERATED_ROOT_DIRECTORIES = ["build/", "out/"];

const GENERATED_SUFFIXES = [
  ".min.js",
  ".min.css",
  ".map",
  ".snap",
  ".pb.go",
  "_pb2.py",
  ".generated.ts",
  ".generated.js",
];

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "pdf",
  "zip", "gz", "tar", "tgz", "7z", "jar",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "wav", "avi",
  "exe", "dll", "so", "dylib", "bin", "wasm",
]);

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function extension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function isInGeneratedDirectory(path: string): boolean {
  if (GENERATED_ROOT_DIRECTORIES.some((dir) => path.startsWith(dir))) {
    return true;
  }
  return GENERATED_DIRECTORIES.some(
    (dir) => path.startsWith(dir) || path.includes(`/${dir}`),
  );
}

/** Returns why a file should be skipped, or null if it should be reviewed. */
export function getSkipReason(
  path: string,
  isBinary: boolean,
): SkipReason | null {
  if (isBinary || BINARY_EXTENSIONS.has(extension(path))) {
    return "binary";
  }
  if (LOCKFILE_NAMES.has(fileName(path))) {
    return "lockfile";
  }
  if (isInGeneratedDirectory(path)) {
    return "generated";
  }
  if (GENERATED_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
    return "generated";
  }
  return null;
}
