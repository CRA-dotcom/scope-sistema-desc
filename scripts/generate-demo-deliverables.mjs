#!/usr/bin/env node
// Generate demo PDFs using the REAL deliverable templates stored in Convex DB,
// filled with data from the Katimi client (org_3Bc04...).
//
// Strategy:
//   1. Load 6 deliverable_long templates (Admin/Legal/Contabilidad/Marketing/Financiero/TI)
//      from scripts/.demo-data/templates.json (dumped via `npx convex data deliverableTemplates`)
//   2. Parse {{placeholders}} directly from each template's HTML (the `variables` array
//      in the DB is out of sync with HTML — ~99 orphan placeholders in TI alone)
//   3. Resolve static placeholders (client_*, projection_*, branding_*, current_date, etc.)
//   4. Batch remaining placeholders into chunks of max 80 keys; one Claude call per chunk
//      returning a JSON object that maps each key to its value
//   5. Replace all placeholders, render PDF via puppeteer-core + system Chrome
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... node scripts/generate-demo-deliverables.mjs
//
// Output: ~/Desktop/projex-deliverables-demo-2026-05-13/

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import puppeteer from "puppeteer-core";

const CONTEXT_PATH = "scripts/.demo-data/katimi-context.json";
const TEMPLATES_PATH = "scripts/.demo-data/templates.json";
const MODEL = "claude-sonnet-4-20250514";
const OUT_DIR = resolve(homedir(), "Desktop", "projex-deliverables-demo-2026-05-13");
const CHUNK_SIZE = 80; // max keys per Claude call
const MAX_OUTPUT_TOKENS = 8192;

const CHROME_PATHS = [
  process.env.CHROMIUM_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

// Areas + chosen template names (one deliverable_long per area)
const PICKS = [
  { order: 1, area: "Admin",        templateName: "Admin - Manual Operativo Master" },
  { order: 2, area: "RH",           templateName: null }, // no long template in DB — will skip
  { order: 3, area: "TI",           templateName: "TI - Diagnóstico Largo" },
  { order: 4, area: "Marketing",    templateName: "Marketing - Plan Anual Completo" },
  { order: 5, area: "Legal",        templateName: "Legal - Master Corporate Governance Blueprint (Entregable Largo)" },
  { order: 6, area: "Contabilidad", templateName: "Informe de Auditoria Interna y Cumplimiento Fiscal" },
  { order: 7, area: "Financiero",   templateName: "Financiero - Reporte Diagnóstico Largo" },
];

// ─── Helpers ───

function fmtMoney(n) { return `$${Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`; }
function fmtPct(p) { return `${(p * 100).toFixed(2)}%`; }
function fmtDate(d = new Date()) {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function findChrome() {
  for (const p of CHROME_PATHS) if (p && existsSync(p)) return p;
  throw new Error(`No Chrome found. Tried: ${CHROME_PATHS.join(", ")}. Set CHROMIUM_PATH.`);
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function replaceAll(html, key, value) {
  const safe = String(value ?? "").replace(/\$/g, "$$$$"); // escape $ for replace
  return html.replace(new RegExp(escapeRegex(`{{${key}}}`), "g"), safe);
}

function extractPlaceholders(html) {
  const re = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  const set = new Set();
  let m;
  while ((m = re.exec(html)) !== null) set.add(m[1]);
  return [...set];
}

// Static var resolution. Returns null if key is unknown (needs AI).
function resolveStatic(key, ctx) {
  const { client, projection, projService, branding, today } = ctx;
  switch (key) {
    // Client
    case "client_name":
    case "company_name":
    case "company_legal_name":
      return client.name;
    case "client_industry":
    case "company_industry":
      return client.industry;
    case "client_rfc":
    case "company_rfc":
    case "manual_client_rfc":
      return client.rfc;
    case "client_billing_frequency":
    case "company_billing_frequency":
      return client.billingFrequency ?? "mensual";
    case "client_revenue":
    case "client_annual_revenue":
    case "company_annual_revenue":
      return fmtMoney(client.annualRevenue);
    case "client_contact_name":
      return client.contactName ?? "";
    case "client_contact_email":
      return client.contactEmail ?? "";
    // Projection
    case "projection_year":
    case "fiscal_year":
      return String(projection.year);
    case "projection_annual_sales":
      return fmtMoney(projection.annualSales);
    case "projection_total_budget":
      return fmtMoney(projection.totalBudget);
    // Service
    case "service_name":
      return projService?.serviceName ?? "";
    case "service_chosen_pct":
      return projService ? fmtPct(projService.chosenPct ?? 0) : "";
    case "service_annual_amount":
      return projService ? fmtMoney(projService.annualAmount > 0
        ? projService.annualAmount
        : Math.round((projService.chosenPct ?? 0) * (projection.effectiveBudget ?? projection.totalBudget))) : "";
    // Branding
    case "branding_company_name":
      return branding.companyName;
    case "branding_footer_text":
      return branding.footerText;
    case "branding_primary_color":
      return branding.primaryColor;
    case "branding_secondary_color":
      return branding.secondaryColor;
    case "branding_accent_color":
      return branding.accentColor;
    case "branding_font_family":
      return branding.fontFamily;
    case "branding_logo_url":
      return branding.logoUrl;
    // Date
    case "current_date":
    case "fecha":
      return today;
    default:
      return null;
  }
}

function parseJsonResponse(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fence) try { return JSON.parse(fence[1]); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error("Could not parse JSON. Preview: " + text.slice(0, 300));
}

class CreditExhaustedError extends Error {
  constructor() { super("Anthropic credit balance exhausted"); this.code = "CREDIT_EXHAUSTED"; }
}

async function callClaudeBatch(anthropic, area, contextBlock, keys) {
  // Build the prompt: ask for a JSON object mapping each key → value.
  const keyHints = keys.map((k) => `"${k}": ${describeKey(k)}`).join(",\n  ");

  const systemPrompt = `Eres un consultor profesional senior de ${area}. Generas contenido para entregables empresariales de alta calidad. Respondes ÚNICAMENTE con JSON válido, sin markdown, sin backticks, sin explicaciones.`;

  // Split user prompt: static cacheable part (context) + dynamic part (keys to fill).
  // The cacheable part must be ≥1024 tokens to qualify (our contextBlock is ~5K+ tokens).
  const cacheablePrompt = `Estoy generando un entregable profesional para el cliente. Te paso el contexto completo del cliente y respuestas del cuestionario.

${contextBlock}

REGLAS PARA TODOS LOS CAMPOS A LLENAR:
- Para campos de texto/descripción: usa español profesional. Puedes usar inline HTML (<strong>, <em>) pero NO uses <p>, <div>, <ul> ya que el template ya tiene la estructura.
- Para scores: número entero entre 0-100.
- Para porcentajes: formato "XX%" o "XX.X%".
- Para montos: formato "$X,XXX,XXX MXN".
- Para fechas: formato "DD de Mes YYYY" en español.
- Para nombres propios (responsables, firmantes): inventa nombres latinos plausibles.
- Sé consistente entre campos relacionados (ej. si hay ai_roi_total_* debe ser la suma de ai_roi_*_1, _2, etc.).
- Si un campo tiene un sufijo numérico (_1, _2, etc.), trátalo como serie y mantén progresión lógica.
- Mantén tono ejecutivo y data-driven.`;

  const dynamicPrompt = `LLENA ESTOS CAMPOS (responde con un único objeto JSON válido, sin markdown):
{
  ${keyHints}
}

JSON:`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [{ type: "text", text: systemPrompt }],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: cacheablePrompt, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamicPrompt },
        ],
      }],
    });
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (msg.includes("credit balance is too low") || msg.includes("CREDIT")) {
      throw new CreditExhaustedError();
    }
    throw err;
  }

  const block = response.content.find((b) => b.type === "text");
  const text = block?.text ?? "";
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cacheCreate = response.usage.cache_creation_input_tokens ?? 0;
  const cacheRead = response.usage.cache_read_input_tokens ?? 0;
  // Cache pricing: write = 1.25x normal input, read = 0.1x normal input
  const cost =
    inputTokens * (3 / 1_000_000) +
    cacheCreate * (3.75 / 1_000_000) +
    cacheRead * (0.30 / 1_000_000) +
    outputTokens * (15 / 1_000_000);

  let parsed;
  try {
    parsed = parseJsonResponse(text);
  } catch (e) {
    console.error("    JSON parse error:", e.message);
    parsed = {};
  }
  return { parsed, inputTokens, outputTokens, cost };
}

function describeKey(key) {
  // Provide a brief hint to Claude about what each key should contain.
  if (/^ai_score/.test(key)) return '"<score 0-100>"';
  if (/_pct$|_percent_?/.test(key)) return '"<XX%>"';
  if (/_amount$|_total$|_investment$|_benefit$|_revenue$|_budget$/.test(key)) return '"<$X,XXX,XXX MXN>"';
  if (/_year$/.test(key)) return '"<año YYYY>"';
  if (/_period$/.test(key)) return '"<periodo: Q1 2026 — Q4 2026>"';
  if (/_date$/.test(key)) return '"<DD de Mes YYYY>"';
  if (/_name$|_role$|_owner$|_reviewer$|_interviewee_/.test(key)) return '"<nombre propio latino, 2-4 palabras>"';
  if (/_area$/.test(key)) return '"<área/categoría, 1-3 palabras>"';
  if (/_paragraph_|_summary$|_description$|_observation_|_methodology$|_conclusion_|executive_/.test(key))
    return '"<párrafo profesional, 60-120 palabras, puede usar inline <strong>>"';
  if (/_finding_|_risk_/.test(key)) return '"<hallazgo o riesgo, 1-2 oraciones>"';
  if (/_initiative_|_action$|_result$|_kpi$|_quick_win_|_roi_/.test(key)) return '"<iniciativa/acción específica, 1-2 oraciones>"';
  return '"<contenido apropiado al label \\\"' + key + '\\\" en contexto profesional>"';
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Main ───

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERR: ANTHROPIC_API_KEY required");
    process.exit(1);
  }
  if (!existsSync(CONTEXT_PATH) || !existsSync(TEMPLATES_PATH)) {
    console.error(`ERR: missing data files. Need ${CONTEXT_PATH} and ${TEMPLATES_PATH}`);
    process.exit(1);
  }

  // --only=Admin,Marketing — filter to just these areas (case-insensitive)
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const onlyAreas = onlyArg
    ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim().toLowerCase())
    : null;
  const picksToRun = onlyAreas
    ? PICKS.filter((p) => onlyAreas.includes(p.area.toLowerCase()))
    : PICKS;
  if (onlyAreas) {
    console.log(`Running --only: ${picksToRun.map((p) => p.area).join(", ")}`);
  }

  const ctxData = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));
  const allTemplates = JSON.parse(readFileSync(TEMPLATES_PATH, "utf8"));
  const { client, projection, projServices, questionnaire, orgBranding } = ctxData;

  const branding = {
    companyName: orgBranding?.companyName ?? "Projex",
    footerText: orgBranding?.footerText ?? "Proyección y entregables automatizados",
    primaryColor: orgBranding?.primaryColor ?? "#1a1a2e",
    secondaryColor: orgBranding?.secondaryColor ?? "#6c63ff",
    accentColor: orgBranding?.accentColor ?? "#22c55e",
    fontFamily: orgBranding?.fontFamily ?? "'IBM Plex Sans', sans-serif",
    logoUrl: "",
  };
  const today = fmtDate();

  // Build questionnaire context (all 185 responses; chunked input is OK at our cost level)
  const responses = questionnaire?.responses ?? [];
  const fullQuestionnaire = responses
    .map((r) => {
      const a = typeof r.answer === "string" ? r.answer : JSON.stringify(r.answer);
      return `[${r.section ?? "General"}] ${r.questionText}\n→ ${a}`;
    })
    .join("\n\n");

  mkdirSync(OUT_DIR, { recursive: true });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const executablePath = findChrome();
  console.log(`Chrome: ${executablePath}`);
  console.log(`Output: ${OUT_DIR}\n`);
  const browser = await puppeteer.launch({
    executablePath, headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let totalCost = 0;
  const results = [];

  let creditExhausted = false;
  for (const pick of picksToRun) {
    if (creditExhausted) {
      console.log(`Skipping ${pick.area} — credit exhausted, aborting remaining areas.`);
      continue;
    }
    console.log(`=== [${pick.order}] ${pick.area} ===`);
    if (!pick.templateName) {
      console.log(`  Skip: no deliverable_long template in DB for ${pick.area}.`);
      continue;
    }
    const template = allTemplates.find((t) => t.name === pick.templateName);
    if (!template) {
      console.log(`  Skip: template "${pick.templateName}" not found in dump.`);
      continue;
    }

    const projService = projServices.find((s) => s.serviceName === pick.area)
      ?? projServices.find((s) => s.serviceName?.toLowerCase().startsWith(pick.area.toLowerCase().slice(0, 4)));

    const ctx = { client, projection, projService, branding, today };

    // 1) Extract placeholders from HTML
    const placeholders = extractPlaceholders(template.htmlTemplate);
    console.log(`  Template: ${template.name} (${template.htmlTemplate.length} chars, ${placeholders.length} placeholders)`);

    // 2) Resolve statics, collect remaining
    const resolved = {};
    const needsAi = [];
    for (const k of placeholders) {
      const val = resolveStatic(k, ctx);
      if (val !== null) resolved[k] = val;
      else needsAi.push(k);
    }
    console.log(`    Static: ${Object.keys(resolved).length}, AI/manual: ${needsAi.length}`);

    // 3) Build context block for Claude
    const projServiceLine = projService
      ? `${projService.serviceName} — ${fmtPct(projService.chosenPct ?? 0)} del presupuesto, monto anual ${fmtMoney(projService.annualAmount > 0 ? projService.annualAmount : (projService.chosenPct ?? 0) * (projection.effectiveBudget ?? projection.totalBudget))}`
      : "Servicio no contratado en la proyección actual";
    const contextBlock = `CLIENTE: ${client.name} (${client.industry}, RFC ${client.rfc}, facturación anual ${fmtMoney(client.annualRevenue)})
PROYECCIÓN ${projection.year}: ventas $${projection.annualSales.toLocaleString("es-MX")} MXN, presupuesto total $${projection.totalBudget.toLocaleString("es-MX")} MXN
SERVICIO (${pick.area}): ${projServiceLine}

RESPUESTAS DEL CUESTIONARIO:
${fullQuestionnaire}`;

    // 4) Chunk AI keys and call Claude
    const chunks = chunkArray(needsAi, CHUNK_SIZE);
    if (chunks.length > 1) console.log(`    Chunks: ${chunks.length} × ~${CHUNK_SIZE} keys`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const { parsed, inputTokens, outputTokens, cost } = await callClaudeBatch(
          anthropic, pick.area, contextBlock, chunk
        );
        const filled = Object.keys(parsed).length;
        totalCost += cost;
        console.log(`    chunk ${i + 1}/${chunks.length}: ${inputTokens}/${outputTokens} tok, $${cost.toFixed(4)}, filled ${filled}/${chunk.length} keys`);
        Object.assign(resolved, parsed);
      } catch (err) {
        if (err.code === "CREDIT_EXHAUSTED") {
          console.error(`    CREDIT EXHAUSTED at chunk ${i + 1}/${chunks.length} — aborting.`);
          creditExhausted = true;
          break;
        }
        console.error(`    chunk ${i + 1} failed:`, err.message);
      }
    }
    if (creditExhausted) break;

    // Retry pass: if some keys are unfilled (truncation/JSON parse), retry with smaller chunks
    const missing1 = needsAi.filter((k) => !(k in resolved));
    if (missing1.length > 0 && !creditExhausted) {
      console.log(`    Retry pass 1: ${missing1.length} keys with chunk size 30`);
      for (const [i, ck] of chunkArray(missing1, 30).entries()) {
        try {
          const { parsed, inputTokens, outputTokens, cost } = await callClaudeBatch(
            anthropic, pick.area, contextBlock, ck
          );
          totalCost += cost;
          console.log(`    retry ${i + 1}: ${inputTokens}/${outputTokens} tok, $${cost.toFixed(4)}, filled ${Object.keys(parsed).length}/${ck.length}`);
          Object.assign(resolved, parsed);
        } catch (err) {
          if (err.code === "CREDIT_EXHAUSTED") {
            console.error(`    CREDIT EXHAUSTED during retry — aborting.`);
            creditExhausted = true; break;
          }
          console.error(`    retry ${i + 1} failed:`, err.message);
        }
      }
    }

    // Second retry pass: any still missing with even smaller chunks
    const missing2 = needsAi.filter((k) => !(k in resolved));
    if (missing2.length > 0 && !creditExhausted) {
      console.log(`    Retry pass 2: ${missing2.length} keys with chunk size 12`);
      for (const [i, ck] of chunkArray(missing2, 12).entries()) {
        try {
          const { parsed, cost } = await callClaudeBatch(anthropic, pick.area, contextBlock, ck);
          totalCost += cost;
          Object.assign(resolved, parsed);
        } catch (err) {
          if (err.code === "CREDIT_EXHAUSTED") { creditExhausted = true; break; }
        }
      }
    }

    // Stuff any remaining unfilled keys with a visible placeholder so the PDF isn't broken
    let unfilled = 0;
    for (const k of needsAi) {
      if (!(k in resolved)) { resolved[k] = `<em style="color:#94a3b8">[${k}]</em>`; unfilled++; }
    }
    if (unfilled) console.log(`    ${unfilled} keys unfilled — left as visible placeholder`);

    // 5) Replace placeholders in HTML
    let html = template.htmlTemplate;
    for (const [k, v] of Object.entries(resolved)) {
      html = replaceAll(html, k, v);
    }

    // 6) Render PDF
    const slug = pick.area.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
    const filename = `${String(pick.order).padStart(2, "0")}-${slug}-katimi.pdf`;
    const outPath = resolve(OUT_DIR, filename);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "10mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
    await page.close();
    console.log(`  → ${filename}\n`);
    results.push({ area: pick.area, path: outPath, placeholders: placeholders.length, ai: needsAi.length });
  }

  await browser.close();
  console.log("════════════════════════════════════════");
  console.log(`Done. Total cost: $${totalCost.toFixed(4)} USD`);
  console.log(`Output: ${OUT_DIR}`);
  for (const r of results) {
    console.log(`  ${r.area}: ${r.placeholders} ph (${r.ai} AI) → ${r.path}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
