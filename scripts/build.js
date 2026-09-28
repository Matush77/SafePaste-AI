// Builds the unpacked extension into dist/safepaste-ai.
//
//   node scripts/build.js            build once
//   node scripts/build.js --watch    rebuild on change
//   node scripts/build.js --zip      build, validate, and write dist/safepaste-ai-<version>.zip
//                                    (refuses to overwrite an existing zip; add --force to replace it)
//   node scripts/build.js --harness  also build the manual paste harness into dist/harness
//
// The version comes from static/manifest.json only.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { zipSync } from "fflate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = join(root, "static");
const distDir = join(root, "dist");
const outDir = join(distDir, "safepaste-ai");
const harnessOutDir = join(distDir, "harness");

const args = new Set(process.argv.slice(2));

/** @type {esbuild.BuildOptions} */
const extensionBuild = {
  entryPoints: {
    contentScript: join(root, "src", "contentScript.js"),
    popup: join(root, "src", "popup", "popup.js")
  },
  outdir: outDir,
  bundle: true,
  format: "iife",
  target: "chrome114",
  // Chrome Web Store review requires readable code, so no minification.
  minify: false,
  legalComments: "none",
  logLevel: "info"
};

/** @type {esbuild.BuildOptions} */
const harnessBuild = {
  entryPoints: { harness: join(root, "tests", "harness", "harness.js") },
  outdir: harnessOutDir,
  bundle: true,
  format: "iife",
  target: "chrome114",
  logLevel: "info"
};

async function main() {
  const manifest = readManifest();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(staticDir, outDir, { recursive: true });

  if (args.has("--harness")) {
    rmSync(harnessOutDir, { recursive: true, force: true });
    mkdirSync(harnessOutDir, { recursive: true });
    cpSync(join(root, "tests", "harness", "index.html"), join(harnessOutDir, "index.html"));
    await esbuild.build(harnessBuild);
  }

  if (args.has("--watch")) {
    const context = await esbuild.context(extensionBuild);
    await context.watch();
    console.log("Watching src/ for changes. Static files are copied once; restart after editing static/.");
    return;
  }

  await esbuild.build(extensionBuild);
  validatePackage(manifest);

  if (args.has("--zip")) {
    const zipPath = join(distDir, `safepaste-ai-${manifest.version}.zip`);
    if (existsSync(zipPath) && !args.has("--force")) {
      throw new Error(`${relative(root, zipPath)} already exists. Bump the version in static/manifest.json, or pass --force to replace it.`);
    }
    writeFileSync(zipPath, zipSync(collectFiles(outDir), { level: 9 }));
    console.log(`Wrote ${relative(root, zipPath)}`);
  }
}

function readManifest() {
  const manifest = JSON.parse(readFileSync(join(staticDir, "manifest.json"), "utf8"));
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error(`Invalid manifest version: ${manifest.version}`);
  }
  return manifest;
}

/** @param {any} manifest */
function validatePackage(manifest) {
  const problems = [];

  if ((manifest.permissions || []).includes("clipboardWrite") || (manifest.permissions || []).includes("clipboardRead")) {
    problems.push("clipboard permissions are not needed and must not be requested");
  }

  const referenced = [
    ...(manifest.content_scripts || []).flatMap((script) => script.js || []),
    manifest.action && manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons || {})
  ].filter(Boolean);
  for (const file of referenced) {
    if (!existsSync(join(outDir, file))) {
      problems.push(`manifest references missing file: ${file}`);
    }
  }

  for (const file of Object.keys(collectFiles(outDir))) {
    if (/^(tests|node_modules)\//.test(file) || /\.(map|md)$/.test(file)) {
      problems.push(`file must not be packaged: ${file}`);
    }
  }

  if (problems.length) {
    throw new Error(`Package validation failed:\n- ${problems.join("\n- ")}`);
  }
}

/**
 * @param {string} dir
 * @returns {Record<string, Uint8Array>}
 */
function collectFiles(dir) {
  /** @type {Record<string, Uint8Array>} */
  const files = {};
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files[relative(dir, path).split(sep).join("/")] = readFileSync(path);
      }
    }
  };
  walk(dir);
  return files;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
