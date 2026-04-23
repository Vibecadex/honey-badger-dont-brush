#!/usr/bin/env node
/*
 * Vercel build step: substitute the anon-key placeholder in index.html
 * with the value from Vercel's environment variables.
 *
 * The game is served as plain static HTML with no framework build step,
 * so Vercel env vars don't auto-inject. This script bridges that gap:
 * it runs during the Vercel build phase (see vercel.json:buildCommand),
 * reads index.html, and does a string substitution into the deployed
 * artifact. The repo's committed copy stays with the placeholder so
 * `git diff` after a deploy is clean.
 *
 * Env var names we'll accept, in priority order:
 *   1. VIBECADE_ANON_KEY          (preferred, explicit)
 *   2. NEXT_PUBLIC_SUPABASE_ANON_KEY  (common across our Vercel projects)
 *   3. VITE_SUPABASE_ANON_KEY     (common across our Vercel projects)
 *   4. SUPABASE_ANON_KEY          (plain fallback)
 *
 * If none are set (e.g. local preview build without env config), we
 * log a warning and leave the placeholder intact. The runtime init
 * in index.html will show its own warning and no-op cleanly.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "index.html");
const PLACEHOLDER = "<PASTE_PROD_ANON_KEY>";

const ENV_CANDIDATES = [
  "VIBECADE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
];

function pickAnonKey() {
  for (const name of ENV_CANDIDATES) {
    const v = process.env[name];
    if (typeof v === "string" && v.length > 0) {
      return { name, value: v };
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(HTML_PATH)) {
    console.error(`[inject-env] ${HTML_PATH} not found — aborting`);
    process.exit(1);
  }

  const html = fs.readFileSync(HTML_PATH, "utf8");
  const placeholderPresent = html.includes(PLACEHOLDER);

  if (!placeholderPresent) {
    console.log(
      "[inject-env] placeholder not present in index.html — nothing to do",
    );
    return;
  }

  const picked = pickAnonKey();
  if (!picked) {
    console.warn(
      `[inject-env] no anon key env var set; tried: ${ENV_CANDIDATES.join(", ")}`,
    );
    console.warn(
      "[inject-env] leaving <PASTE_PROD_ANON_KEY> placeholder — Vibecade integration will stay inert at runtime",
    );
    return;
  }

  const out = html.split(PLACEHOLDER).join(picked.value);
  fs.writeFileSync(HTML_PATH, out, "utf8");
  console.log(
    `[inject-env] injected anon key from $${picked.name} into index.html (${picked.value.length} chars)`,
  );
}

main();
