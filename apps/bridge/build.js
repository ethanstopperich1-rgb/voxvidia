// Bundle the bridge app into a single file for deployment
const { build } = require("esbuild");

build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/server.js",
  format: "cjs",
  external: ["twilio"],
  sourcemap: true,
}).then(() => console.log("Bridge bundled successfully"))
  .catch((e) => { console.error(e); process.exit(1); });
