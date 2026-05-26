#!/usr/bin/env tsx
/**
 * Bulk-import HTML templates from convex/seeds/templates/ to Convex DB.
 *
 * SECURITY:
 * - CONVEX_DEPLOY_KEY is admin-scoped. Rotate after every import session.
 * - This script only reads from TEMPLATES_DIR. Filename safety check
 *   prevents path traversal and symlink escapes.
 * - Errors are sanitized before logging (HTML tags stripped) to avoid
 *   leaking template content into CI/log capture.
 *
 * Naming convention: <parent-svc-slug>__<subservice-slug>[-<type>].html
 *   Default type: deliverable_long
 *   Valid suffixes: -quotation -contract -short -long -questionnaire
 *
 * Run:
 *   CONVEX_DEPLOY_KEY="..." NEXT_PUBLIC_CONVEX_URL="..." \
 *     npx tsx scripts/import-templates.ts [path]
 *
 * Spec: docs/superpowers/specs/2026-05-25-deliverable-content-catalog-design.md §7
 */

import { readFile, readdir, realpath } from "fs/promises";
import { join, basename } from "path";
import { ConvexHttpClient } from "convex/browser";
import { type FunctionReference } from "convex/server";
import { internal } from "../convex/_generated/api";

const TEMPLATES_DIR = process.argv[2] ?? "./convex/seeds/templates";

function isSafeFilename(name: string): boolean {
  // Must end in .html, must not contain path separators or traversal
  if (!name.endsWith(".html")) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  // Convention: <parent>__<sub>[-<type>].html — restrict to safe chars
  return /^[a-zA-Z0-9_-]+(__[a-zA-Z0-9_-]+)?(-(?:quotation|contract|short|long|questionnaire))?\.html$/.test(
    name
  );
}
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;

// Map slug → display name (must match catalog services). Extend as needed.
const SLUG_TO_NAME: Record<string, string> = {
  legal: "Legal",
  contable: "Contable",
  ti: "TI",
  marketing: "Marketing",
  rh: "RH",
  admin: "Admin",
  comisiones: "Comisiones",
  logistica: "Logística",
  construccion: "Construcción",
};

type TemplateType =
  | "quotation"
  | "contract"
  | "deliverable_short"
  | "deliverable_long"
  | "questionnaire";

function parseFilename(filename: string): {
  parentSvcSlug: string;
  subserviceSlug: string;
  type: TemplateType;
} {
  const base = basename(filename, ".html");
  const [parentSvcSlug, rest] = base.split("__");
  if (!parentSvcSlug || !rest) {
    throw new Error(
      `Invalid name "${filename}": expected <parent>__<subslug>[-<type>].html`
    );
  }
  const typeMatch = rest.match(
    /-(quotation|contract|short|long|questionnaire)$/
  );
  let type: TemplateType = "deliverable_long";
  let subserviceSlug = rest;
  if (typeMatch) {
    const suffix = typeMatch[1];
    type =
      suffix === "short"
        ? "deliverable_short"
        : suffix === "long"
          ? "deliverable_long"
          : (suffix as TemplateType);
    subserviceSlug = rest.slice(0, -typeMatch[0].length);
  }
  return { parentSvcSlug, subserviceSlug, type };
}

function humanize(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function typeLabel(type: TemplateType): string {
  return {
    quotation: "Cotización",
    contract: "Contrato",
    deliverable_short: "Reporte Breve",
    deliverable_long: "Reporte Completo",
    questionnaire: "Cuestionario",
  }[type];
}

async function main() {
  if (!CONVEX_URL || !DEPLOY_KEY) {
    console.error(
      "Missing env vars. Run: CONVEX_DEPLOY_KEY=$(npx convex deploy-key) NEXT_PUBLIC_CONVEX_URL=... npx tsx scripts/import-templates.ts"
    );
    process.exit(1);
  }

  const client = new ConvexHttpClient(CONVEX_URL);
  // setAdminAuth exists at runtime but is not yet typed in the public d.ts
  (client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(DEPLOY_KEY);

  const safeDir = await realpath(TEMPLATES_DIR);

  const all = await readdir(TEMPLATES_DIR);
  const files = all.filter((f) => f.endsWith(".html") && isSafeFilename(f));
  const rejected = all.filter((f) => f.endsWith(".html") && !isSafeFilename(f));
  for (const r of rejected) {
    console.warn(`! skipping unsafe filename: ${r}`);
  }
  console.log(`Found ${files.length} HTML templates in ${TEMPLATES_DIR}\n`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const { parentSvcSlug, subserviceSlug, type } = parseFilename(file);
      const fullPath = join(TEMPLATES_DIR, file);
      const resolved = await realpath(fullPath);
      if (!resolved.startsWith(safeDir + "/") && resolved !== safeDir) {
        console.error(`✗ ${file}: path escapes templates dir`);
        errors++;
        continue;
      }
      const html = await readFile(resolved, "utf-8");

      const parentServiceName = SLUG_TO_NAME[parentSvcSlug];
      if (!parentServiceName) {
        throw new Error(
          `Unknown parent slug "${parentSvcSlug}". Add it to SLUG_TO_NAME.`
        );
      }

      const name = `${humanize(subserviceSlug)} — ${typeLabel(type)}`;

      // Cast internal ref to public FunctionReference — ConvexHttpClient.mutation()
      // typing requires "public" visibility, but the HTTP wire protocol accepts
      // internal mutations when authenticated with an admin deploy key.
      const result = await client.mutation(
        internal.functions.deliverableTemplates.bulkImport
          .upsertFromFile as unknown as FunctionReference<"mutation">,
        {
          parentServiceName,
          subserviceSlug,
          type,
          name,
          htmlTemplate: html,
        }
      );

      const sym = result.action === "created" ? "✓ created" : "↻ updated";
      console.log(`${sym} ${file} (status: ${result.contentStatus})`);
      if (result.action === "created") created++;
      else updated++;
    } catch (err) {
      const raw = (err as Error).message ?? String(err);
      // Strip HTML tags + truncate to keep payloads out of CI logs
      const safe = raw.replace(/<[^>]*>/g, "[html]").slice(0, 300);
      console.error(`✗ ${file}: ${safe}`);
      errors++;
    }
  }

  console.log(`\n${created} created · ${updated} updated · ${errors} errors`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
