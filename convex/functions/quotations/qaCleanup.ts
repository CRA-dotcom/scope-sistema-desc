import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

/**
 * One-shot cleanup: remove rows created by the QA seed script that may have
 * leaked into production.
 *
 * REQUIRED ARG: dryRun (boolean) — pass true first to preview, then false to execute.
 *
 * Preview (counts what WOULD be deleted, no writes):
 *   npx convex run --prod functions/quotations/qaCleanup:purgeQaService '{"dryRun":true}'
 *
 * Execute (actually deletes):
 *   npx convex run --prod functions/quotations/qaCleanup:purgeQaService '{"dryRun":false}'
 *
 * After running successfully, delete this file in a follow-up commit.
 *
 * Tables cleaned (matches what qaSeedMutation.ts inserts):
 *   - quotations     → serviceName contains "QA Service"
 *   - projectionServices → serviceName === "QA Service"
 *   - projections    → linked to a QA client (orgId === "org_qa_screenshot")
 *   - services       → name === "QA Service"
 *   - clients        → name === "Cliente QA"
 *   - issuingCompanies → name === "Empresa QA"
 */
export const purgeQaService = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    let matchedQuotations = 0;
    let matchedProjServices = 0;
    let matchedProjections = 0;
    let matchedServices = 0;
    let matchedClients = 0;
    let matchedIssuingCompanies = 0;

    // 1. Quotations seeded by QA (identified by serviceName field)
    const quotations = await ctx.db.query("quotations").collect();
    for (const q of quotations) {
      if (q.serviceName && q.serviceName.includes("QA Service")) {
        if (!dryRun) await ctx.db.delete(q._id);
        matchedQuotations++;
      }
    }

    // 2. ProjectionServices rows with QA serviceName
    const projServices = await ctx.db.query("projectionServices").collect();
    for (const ps of projServices) {
      if (ps.serviceName === "QA Service") {
        if (!dryRun) await ctx.db.delete(ps._id);
        matchedProjServices++;
      }
    }

    // 3. Projections seeded for QA org
    // NOTE: This filter matches only the orgId from the documented usage example.
    // If the seed was run with a different orgId, those projections will NOT be deleted.
    // Verify via Convex dashboard before running: confirm all QA projections use this orgId.
    const projections = await ctx.db.query("projections").collect();
    for (const p of projections) {
      if (p.orgId === "org_qa_screenshot") {
        if (!dryRun) await ctx.db.delete(p._id);
        matchedProjections++;
      }
    }

    // 4. Services with name === "QA Service"
    const services = await ctx.db.query("services").collect();
    for (const s of services) {
      if (s.name === "QA Service") {
        if (!dryRun) await ctx.db.delete(s._id);
        matchedServices++;
      }
    }

    // 5. Clients seeded by QA script
    const clients = await ctx.db.query("clients").collect();
    for (const c of clients) {
      if (c.name === "Cliente QA") {
        if (!dryRun) await ctx.db.delete(c._id);
        matchedClients++;
      }
    }

    // 6. Issuing companies seeded by QA script
    const companies = await ctx.db.query("issuingCompanies").collect();
    for (const ic of companies) {
      if (ic.name === "Empresa QA") {
        if (!dryRun) await ctx.db.delete(ic._id);
        matchedIssuingCompanies++;
      }
    }

    return {
      mode: dryRun ? "DRY_RUN (no writes)" : "EXECUTED",
      matchedQuotations,
      matchedProjServices,
      matchedProjections,
      matchedServices,
      matchedClients,
      matchedIssuingCompanies,
      total:
        matchedQuotations +
        matchedProjServices +
        matchedProjections +
        matchedServices +
        matchedClients +
        matchedIssuingCompanies,
    };
  },
});
