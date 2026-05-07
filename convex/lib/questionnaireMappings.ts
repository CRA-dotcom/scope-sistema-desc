import { type Id } from "../_generated/dataModel";

/**
 * Build a flat object of { variableName: value } per template, by walking
 * the question→variable mappings and pulling the answer from responses.
 *
 * For file_upload questions, exposes:
 *   - {variableName}_storageId: the Convex _storage ID (caller resolves via ctx.storage.getUrl)
 *   - {variableName}_filename: original filename if stored
 *
 * Returns: Map<templateId, Record<variableName, string>>
 */
export type QuestionWithMappings = {
  key: string;
  type: string;
  templateVariableMappings?: Array<{ templateId: string; variableName: string }>;
};

export type ResponseEntry = {
  questionKey: string;
  value: string; // for file_upload, this is a _storage ID
  filename?: string; // optional original filename, may be stored alongside
};

export function buildTemplateVariables(
  questions: QuestionWithMappings[],
  responses: ResponseEntry[]
): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();

  for (const q of questions) {
    if (!q.templateVariableMappings || q.templateVariableMappings.length === 0) continue;
    const response = responses.find((r) => r.questionKey === q.key);
    if (!response) continue;

    for (const mapping of q.templateVariableMappings) {
      const tid = mapping.templateId;
      if (!result.has(tid)) result.set(tid, {});
      const vars = result.get(tid)!;

      if (q.type === "file_upload") {
        // Caller resolves these to signed URL + filename via ctx.storage.getUrl(value)
        vars[`${mapping.variableName}_storageId`] = response.value;
        if (response.filename) {
          vars[`${mapping.variableName}_filename`] = response.filename;
        }
      } else {
        vars[mapping.variableName] = response.value;
      }
    }
  }

  return result;
}
