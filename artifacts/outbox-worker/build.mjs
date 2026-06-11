import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const agentReplyPath = path.resolve(artifactDir, "../api-server/src/lib/agent-reply.ts");

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.mjs",
  external: ["*.node", "pg-native"],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
globalThis.require = __bannerCrReq(import.meta.url);`,
  },
  plugins: [
    {
      name: "workspace-api-server-agent-reply",
      setup(build) {
        build.onResolve(
          { filter: /^@workspace\/api-server\/src\/lib\/agent-reply$/ },
          () => ({ path: agentReplyPath }),
        );
      },
    },
  ],
});
