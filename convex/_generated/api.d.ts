/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as functions_clients_mutations from "../functions/clients/mutations.js";
import type * as functions_clients_queries from "../functions/clients/queries.js";
import type * as functions_contracts_actions from "../functions/contracts/actions.js";
import type * as functions_contracts_internalQueries from "../functions/contracts/internalQueries.js";
import type * as functions_contracts_mutations from "../functions/contracts/mutations.js";
import type * as functions_contracts_queries from "../functions/contracts/queries.js";
import type * as functions_cron_monthlyCheck from "../functions/cron/monthlyCheck.js";
import type * as functions_cron_overdueCheck from "../functions/cron/overdueCheck.js";
import type * as functions_dashboard_documentCycle from "../functions/dashboard/documentCycle.js";
import type * as functions_dashboard_queries from "../functions/dashboard/queries.js";
import type * as functions_deliverableTemplates_mutations from "../functions/deliverableTemplates/mutations.js";
import type * as functions_deliverableTemplates_queries from "../functions/deliverableTemplates/queries.js";
import type * as functions_deliverableTemplates_seed from "../functions/deliverableTemplates/seed.js";
import type * as functions_deliverables_actions from "../functions/deliverables/actions.js";
import type * as functions_deliverables_internalQueries from "../functions/deliverables/internalQueries.js";
import type * as functions_deliverables_mutations from "../functions/deliverables/mutations.js";
import type * as functions_deliverables_queries from "../functions/deliverables/queries.js";
import type * as functions_email_internalMutations from "../functions/email/internalMutations.js";
import type * as functions_email_internalQueries from "../functions/email/internalQueries.js";
import type * as functions_email_mutations from "../functions/email/mutations.js";
import type * as functions_email_queries from "../functions/email/queries.js";
import type * as functions_email_resolveConfig from "../functions/email/resolveConfig.js";
import type * as functions_email_send from "../functions/email/send.js";
import type * as functions_issuingCompanies_helpers from "../functions/issuingCompanies/helpers.js";
import type * as functions_issuingCompanies_mutations from "../functions/issuingCompanies/mutations.js";
import type * as functions_issuingCompanies_queries from "../functions/issuingCompanies/queries.js";
import type * as functions_issuingCompanies_resolve from "../functions/issuingCompanies/resolve.js";
import type * as functions_monthlyAssignments_billingQueries from "../functions/monthlyAssignments/billingQueries.js";
import type * as functions_monthlyAssignments_mutations from "../functions/monthlyAssignments/mutations.js";
import type * as functions_monthlyAssignments_queries from "../functions/monthlyAssignments/queries.js";
import type * as functions_orgBranding_mutations from "../functions/orgBranding/mutations.js";
import type * as functions_orgBranding_queries from "../functions/orgBranding/queries.js";
import type * as functions_orgConfigs_mutations from "../functions/orgConfigs/mutations.js";
import type * as functions_orgConfigs_queries from "../functions/orgConfigs/queries.js";
import type * as functions_organizations_mutations from "../functions/organizations/mutations.js";
import type * as functions_organizations_queries from "../functions/organizations/queries.js";
import type * as functions_projectionServices_mutations from "../functions/projectionServices/mutations.js";
import type * as functions_projectionServices_queries from "../functions/projectionServices/queries.js";
import type * as functions_projections_mutations from "../functions/projections/mutations.js";
import type * as functions_projections_queries from "../functions/projections/queries.js";
import type * as functions_questionnaires_mutations from "../functions/questionnaires/mutations.js";
import type * as functions_questionnaires_publicMutations from "../functions/questionnaires/publicMutations.js";
import type * as functions_questionnaires_publicQueries from "../functions/questionnaires/publicQueries.js";
import type * as functions_questionnaires_queries from "../functions/questionnaires/queries.js";
import type * as functions_quotations_actions from "../functions/quotations/actions.js";
import type * as functions_quotations_internalQueries from "../functions/quotations/internalQueries.js";
import type * as functions_quotations_mutations from "../functions/quotations/mutations.js";
import type * as functions_quotations_queries from "../functions/quotations/queries.js";
import type * as functions_seed_v2Fixtures from "../functions/seed/v2Fixtures.js";
import type * as functions_services_backfill from "../functions/services/backfill.js";
import type * as functions_services_mutations from "../functions/services/mutations.js";
import type * as functions_services_queries from "../functions/services/queries.js";
import type * as functions_services_seed from "../functions/services/seed.js";
import type * as functions_storage_mutations from "../functions/storage/mutations.js";
import type * as http from "../http.js";
import type * as lib_authHelpers from "../lib/authHelpers.js";
import type * as lib_projectionEngine from "../lib/projectionEngine.js";
import type * as lib_templateVariables from "../lib/templateVariables.js";
import type * as lib_validators from "../lib/validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "functions/clients/mutations": typeof functions_clients_mutations;
  "functions/clients/queries": typeof functions_clients_queries;
  "functions/contracts/actions": typeof functions_contracts_actions;
  "functions/contracts/internalQueries": typeof functions_contracts_internalQueries;
  "functions/contracts/mutations": typeof functions_contracts_mutations;
  "functions/contracts/queries": typeof functions_contracts_queries;
  "functions/cron/monthlyCheck": typeof functions_cron_monthlyCheck;
  "functions/cron/overdueCheck": typeof functions_cron_overdueCheck;
  "functions/dashboard/documentCycle": typeof functions_dashboard_documentCycle;
  "functions/dashboard/queries": typeof functions_dashboard_queries;
  "functions/deliverableTemplates/mutations": typeof functions_deliverableTemplates_mutations;
  "functions/deliverableTemplates/queries": typeof functions_deliverableTemplates_queries;
  "functions/deliverableTemplates/seed": typeof functions_deliverableTemplates_seed;
  "functions/deliverables/actions": typeof functions_deliverables_actions;
  "functions/deliverables/internalQueries": typeof functions_deliverables_internalQueries;
  "functions/deliverables/mutations": typeof functions_deliverables_mutations;
  "functions/deliverables/queries": typeof functions_deliverables_queries;
  "functions/email/internalMutations": typeof functions_email_internalMutations;
  "functions/email/internalQueries": typeof functions_email_internalQueries;
  "functions/email/mutations": typeof functions_email_mutations;
  "functions/email/queries": typeof functions_email_queries;
  "functions/email/resolveConfig": typeof functions_email_resolveConfig;
  "functions/email/send": typeof functions_email_send;
  "functions/issuingCompanies/helpers": typeof functions_issuingCompanies_helpers;
  "functions/issuingCompanies/mutations": typeof functions_issuingCompanies_mutations;
  "functions/issuingCompanies/queries": typeof functions_issuingCompanies_queries;
  "functions/issuingCompanies/resolve": typeof functions_issuingCompanies_resolve;
  "functions/monthlyAssignments/billingQueries": typeof functions_monthlyAssignments_billingQueries;
  "functions/monthlyAssignments/mutations": typeof functions_monthlyAssignments_mutations;
  "functions/monthlyAssignments/queries": typeof functions_monthlyAssignments_queries;
  "functions/orgBranding/mutations": typeof functions_orgBranding_mutations;
  "functions/orgBranding/queries": typeof functions_orgBranding_queries;
  "functions/orgConfigs/mutations": typeof functions_orgConfigs_mutations;
  "functions/orgConfigs/queries": typeof functions_orgConfigs_queries;
  "functions/organizations/mutations": typeof functions_organizations_mutations;
  "functions/organizations/queries": typeof functions_organizations_queries;
  "functions/projectionServices/mutations": typeof functions_projectionServices_mutations;
  "functions/projectionServices/queries": typeof functions_projectionServices_queries;
  "functions/projections/mutations": typeof functions_projections_mutations;
  "functions/projections/queries": typeof functions_projections_queries;
  "functions/questionnaires/mutations": typeof functions_questionnaires_mutations;
  "functions/questionnaires/publicMutations": typeof functions_questionnaires_publicMutations;
  "functions/questionnaires/publicQueries": typeof functions_questionnaires_publicQueries;
  "functions/questionnaires/queries": typeof functions_questionnaires_queries;
  "functions/quotations/actions": typeof functions_quotations_actions;
  "functions/quotations/internalQueries": typeof functions_quotations_internalQueries;
  "functions/quotations/mutations": typeof functions_quotations_mutations;
  "functions/quotations/queries": typeof functions_quotations_queries;
  "functions/seed/v2Fixtures": typeof functions_seed_v2Fixtures;
  "functions/services/backfill": typeof functions_services_backfill;
  "functions/services/mutations": typeof functions_services_mutations;
  "functions/services/queries": typeof functions_services_queries;
  "functions/services/seed": typeof functions_services_seed;
  "functions/storage/mutations": typeof functions_storage_mutations;
  http: typeof http;
  "lib/authHelpers": typeof lib_authHelpers;
  "lib/projectionEngine": typeof lib_projectionEngine;
  "lib/templateVariables": typeof lib_templateVariables;
  "lib/validators": typeof lib_validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
