import esbuild from "esbuild";
import fs from "fs";
import path from "path";

const outdir = process.env.OUTDIR || "./dist";
const watch = process.argv.includes("--watch");

// Ensure output directory exists
if (!fs.existsSync(outdir)) {
  fs.mkdirSync(outdir, { recursive: true });
}

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2018",
  platform: "browser",
  outfile: path.join(outdir, "main.js"),
  sourcemap: true,
  external: ["obsidian"],
  logLevel: "info",
});

// Copy static files to output
function copyStatics() {
  fs.copyFileSync("manifest.json", path.join(outdir, "manifest.json"));
  if (fs.existsSync("styles.css")) {
    fs.copyFileSync("styles.css", path.join(outdir, "styles.css"));
  }
  console.log("✓ Copied manifest.json to", outdir);
}

if (watch) {
  copyStatics();
  await ctx.watch();
  console.log("👀 Watching for changes...");
} else {
  await ctx.rebuild();
  copyStatics();
  await ctx.dispose();
  console.log("✓ Build complete");
}