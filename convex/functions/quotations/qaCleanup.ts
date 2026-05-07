import { internalMutation } from "../../_generated/server";

/**
 * One-shot cleanup: remove rows created by the QA seed script that may have
 * leaked into production. Run manually via:
 *
 *   npx convex run --prod functions/quotations/qaCleanup:purgeQaService
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
  args: {},
  handler: async (ctx) => {
    let deletedQuotations = 0;
    let deletedProjServices = 0;
    let deletedProjections = 0;
    let deletedServices = 0;
    let deletedClients = 0;
    let deletedIssuingCompanies = 0;

    // 1. Delete quotations seeded by QA (identified by serviceName field)
    const quotations = await ctx.db.query("quotations").collect();
    for (const q of quotations) {
      if (q.serviceName && q.serviceName.includes("QA Service")) {
        await ctx.db.delete(q._id);
        deletedQuotations++;
      }
    }

    // 2. Delete projectionServices rows with QA serviceName
    const projServices = await ctx.db.query("projectionServices").collect();
    for (const ps of projServices) {
      if (ps.serviceName === "QA Service") {
        await ctx.db.delete(ps._id);
        deletedProjServices++;
      }
    }

    // 3. Delete projections seeded for QA org
    // NOTE: This filter matches only the orgId from the documented usage example.
    // If the seed was run with a different orgId, those projections will NOT be deleted.
    // Verify via Convex dashboard before running: confirm all QA projections use this orgId.
    const projections = await ctx.db.query("projections").collect();
    for (const p of projections) {
      if (p.orgId === "org_qa_screenshot") {
        await ctx.db.delete(p._id);
        deletedProjections++;
      }
    }

    // 4. Delete services with name === "QA Service"
    const services = await ctx.db.query("services").collect();
    for (const s of services) {
      if (s.name === "QA Service") {
        await ctx.db.delete(s._id);
        deletedServices++;
      }
    }

    // 5. Delete clients seeded by QA script
    const clients = await ctx.db.query("clients").collect();
    for (const c of clients) {
      if (c.name === "Cliente QA") {
        await ctx.db.delete(c._id);
        deletedClients++;
      }
    }

    // 6. Delete issuing companies seeded by QA script
    const companies = await ctx.db.query("issuingCompanies").collect();
    for (const ic of companies) {
      if (ic.name === "Empresa QA") {
        await ctx.db.delete(ic._id);
        deletedIssuingCompanies++;
      }
    }

    return {
      deletedQuotations,
      deletedProjServices,
      deletedProjections,
      deletedServices,
      deletedClients,
      deletedIssuingCompanies,
    };
  },
});
