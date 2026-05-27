"use node";
import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FirmameSigner = {
  email: string;
  name: string;
  /** "client" = the client who signs; "issuer" = co-signer from the firm */
  role: "client" | "issuer";
};

export type FirmameCreateDocumentResult = {
  documentId: string;
  signUrl: string;
  status: string;
};

export type FirmameClientConfig = {
  apiKey: string;
  sandbox: boolean;
  /** Optional HMAC secret for verifying incoming Firmame webhooks */
  webhookSecret?: string;
};

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class FirmameApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`Firmame API error ${statusCode}: ${body}`);
    this.name = "FirmameApiError";
  }
}

// ---------------------------------------------------------------------------
// Endpoint config
// TODO(task-11): Replace placeholder URLs with real Firmame endpoints once
//               API docs are provided (sandbox + production base URLs).
// ---------------------------------------------------------------------------

const ENDPOINTS = {
  sandbox: "https://sandbox.firmame.com/api/v1",   // TODO: confirm from Firmame docs
  production: "https://api.firmame.com/api/v1",     // TODO: confirm from Firmame docs
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFirmameClient(config: FirmameClientConfig) {
  const baseUrl = config.sandbox ? ENDPOINTS.sandbox : ENDPOINTS.production;

  /**
   * Upload a PDF to Firmame and create a signature request.
   *
   * TODO(task-11): Align payload shape (field names, auth header, multipart vs
   *               JSON) with real Firmame API docs when available.
   */
  async function createDocument(args: {
    title: string;
    pdfBuffer: Buffer;
    signers: FirmameSigner[];
    /** Optional Unix-ms deadline (convert to the scheme Firmame expects) */
    deadline?: number;
  }): Promise<FirmameCreateDocumentResult> {
    // TODO(task-11): Adjust form field names to match real Firmame payload spec.
    const formData = new FormData();
    formData.append("title", args.title);
    formData.append(
      "pdf",
      new Blob([args.pdfBuffer], { type: "application/pdf" }),
    );
    formData.append("signers", JSON.stringify(args.signers));
    if (args.deadline !== undefined) {
      formData.append("deadline", String(args.deadline));
    }

    const res = await fetch(`${baseUrl}/documents`, {
      method: "POST",
      // TODO(task-11): Confirm Firmame auth header name (Bearer vs API-Key).
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new FirmameApiError(res.status, body);
    }

    // TODO(task-11): Map real Firmame response field names here.
    const json = (await res.json()) as {
      document_id: string;
      sign_url: string;
      status: string;
    };
    return {
      documentId: json.document_id,
      signUrl: json.sign_url,
      status: json.status,
    };
  }

  /**
   * Download the signed PDF binary for a completed Firmame document.
   *
   * TODO(task-11): Confirm endpoint path from Firmame docs.
   */
  async function downloadSignedPdf(documentId: string): Promise<Buffer> {
    const res = await fetch(`${baseUrl}/documents/${documentId}/signed`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) {
      throw new FirmameApiError(res.status, await res.text());
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Verify an incoming Firmame webhook signature.
   *
   * Assumes HMAC-SHA256 hex of the raw body signed with `webhookSecret`.
   * TODO(task-11): Confirm HMAC scheme + header name from Firmame webhook docs.
   * Full roundtrip test (Task 12) will validate the computed expected value.
   */
  function verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!config.webhookSecret) return false;

    const expected = createHmac("sha256", config.webhookSecret)
      .update(rawBody)
      .digest("hex");

    // Length guard prevents timing-safe comparison on mismatched lengths.
    if (expected.length !== signature.length) return false;

    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  return { createDocument, downloadSignedPdf, verifyWebhookSignature };
}
