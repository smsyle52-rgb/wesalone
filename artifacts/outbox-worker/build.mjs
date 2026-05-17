import { build as esbuild } from "esbuild";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(artifactDir, "dist");

await rm(distDir, { recursive: true, force: true });

await esbuild({
  entryPoints: [path.resolve(artifactDir, "src/index.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.resolve(distDir, "index.mjs"),
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  sourcemap: "linked",
  external: ["pg-native"],
});
