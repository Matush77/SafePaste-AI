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
import { SITE_LIST, originsOf } from "../src/shared/sites.js";

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
    popup: join(root, "src", "popup", "popup.js"),
    background: join(root, "src", "background.js"),
    welcome: join(root, "src", "welcome", "welcome.js")
  },
  outdir: outDir,
  bundle: true,
  format: "iife",
  target: "chrome116",
  // Chrome Web Store review requires readable code, so no minification.
  minify: false,
  legalComments: "none",
  logLevel: "info"
};

// The offscreen document runs the optional name model with transformers.js.
// It is an ES module because the ONNX runtime loads its WebAssembly glue
// with a dynamic import.
// The ONNX runtime that transformers.js uses: a stable release pinned in
// package.json "overrides" (transformers.js itself pins a dev build), which
// npm may install inside transformers.js's own node_modules.
const ortDist = [
  join(root, "node_modules", "@huggingface", "transformers", "node_modules", "onnxruntime-web", "dist"),
  join(root, "node_modules", "onnxruntime-web", "dist")
].find((dir) => existsSync(dir)) || "";
const onnxWasmOnly = join(ortDist, "ort.wasm.min.mjs");
/** @type {esbuild.BuildOptions} */
const offscreenBuild = {
  entryPoints: { offscreen: join(root, "src", "offscreen", "offscreen.js") },
  outdir: outDir,
  bundle: true,
  format: "esm",
  target: "chrome116",
  minify: false,
  legalComments: "none",
  logLevel: "info",
  // transformers.js imports the WebGPU build of the runtime (28 MB of
  // WebAssembly). The model runs fine on the CPU build, which is half the size.
  alias: {
    "onnxruntime-web/webgpu": onnxWasmOnly,
    "onnxruntime-web": onnxWasmOnly
  }
};

// Runtime files loaded by the offscreen document from inside the extension.
const ONNX_RUNTIME_FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

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
  await esbuild.build(offscreenBuild);
  pointRuntimeDefaultsAtPackage();
  mkdirSync(join(outDir, "ort"), { recursive: true });
  for (const file of ONNX_RUNTIME_FILES) {
    cpSync(join(ortDist, file), join(outDir, "ort", file));
  }
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

/**
 * transformers.js defaults the ONNX runtime's WebAssembly location to a CDN
 * (jsDelivr). SafePaste always sets it to the copy in the package before
 * anything loads, and the extension's CSP would block a remote script anyway,
 * but the package should not contain a remote-code address at all, so the
 * default is rewritten to the packaged copy.
 */
function pointRuntimeDefaultsAtPackage() {
  const file = join(outDir, "offscreen.js");
  const source = readFileSync(file, "utf8");
  const cdnDefault = /`https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\$\{[^}`]+\}\/dist\/`/g;
  const matches = source.match(cdnDefault) || [];
  if (matches.length !== 1) {
    throw new Error(`Expected one CDN default for the ONNX runtime in offscreen.js, found ${matches.length}; update pointRuntimeDefaultsAtPackage().`);
  }
  writeFileSync(file, source.replace(cdnDefault, "chrome.runtime.getURL(\"ort/\")"));
}

/** @param {any} manifest */
function validatePackage(manifest) {
  const problems = [];

  // No code may be loaded from a CDN (Chrome Web Store remote-code policy).
  for (const file of Object.keys(collectFiles(outDir))) {
    if (/\.(m?js|html)$/.test(file) && /https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|cdn\.skypack\.dev)/.test(readFileSync(join(outDir, file), "utf8"))) {
      problems.push(`remote code address (CDN) found in ${file}`);
    }
  }

  if ((manifest.permissions || []).includes("clipboardWrite") || (manifest.permissions || []).includes("clipboardRead")) {
    problems.push("clipboard permissions are not needed and must not be requested");
  }

  // The manifest's site lists must match src/shared/sites.js.
  /** @param {string[]} list */
  const sorted = (list) => [...list].sort().join(" ");
  const builtIn = SITE_LIST.filter((site) => !site.optional).flatMap(originsOf);
  const optional = SITE_LIST.filter((site) => site.optional).flatMap(originsOf);
  if (sorted(manifest.host_permissions || []) !== sorted(builtIn)) {
    problems.push(`host_permissions must be the built-in sites: ${builtIn.join(", ")}`);
  }
  if (sorted(manifest.optional_host_permissions || []) !== sorted(optional)) {
    problems.push(`optional_host_permissions must be the optional sites: ${optional.join(", ")}`);
  }
  const scriptMatches = (manifest.content_scripts || []).flatMap((/** @type {any} */ script) => script.matches || []);
  if (sorted(scriptMatches) !== sorted(builtIn)) {
    problems.push("content_scripts must match the built-in sites; optional sites are registered at run time");
  }

  const referenced = [
    ...(manifest.content_scripts || []).flatMap((script) => script.js || []),
    manifest.background && manifest.background.service_worker,
    "offscreen.html",
    "offscreen.js",
    "welcome.html",
    "welcome.js",
    // Licence notices for bundled third-party code must ship with it.
    "THIRD_PARTY_NOTICES.md",
    ...ONNX_RUNTIME_FILES.map((file) => `ort/${file}`),
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
    if (/^(tests|node_modules)\//.test(file) || (/\.(map|md)$/.test(file) && file !== "THIRD_PARTY_NOTICES.md")) {
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
