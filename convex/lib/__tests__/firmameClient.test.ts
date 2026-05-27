import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { createFirmameClient } from "../firmameClient";

describe("firmameClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("createDocument", () => {
    it("POSTs to Firmame with API key and returns documentId + signUrl", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          document_id: "firmame_abc123",
          sign_url: "https://firmame.com/sign/abc123",
          status: "pending",
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createFirmameClient({
        apiKey: "test-api-key",
        sandbox: true,
      });

      const result = await client.createDocument({
        title: "Contrato X",
        pdfBuffer: Buffer.from("fake-pdf-bytes"),
        signers: [{ email: "client@x.com", name: "Cliente", role: "client" }],
      });

      expect(result.documentId).toBe("firmame_abc123");
      expect(result.signUrl).toBe("https://firmame.com/sign/abc123");
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toMatch(/firmame/);
      expect(options.headers.Authorization).toContain("test-api-key");
    });

    it("throws FirmameApiError on non-2xx", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createFirmameClient({ apiKey: "bad", sandbox: true });

      await expect(
        client.createDocument({
          title: "x",
          pdfBuffer: Buffer.from("x"),
          signers: [{ email: "x@x.com", name: "X", role: "client" }],
        })
      ).rejects.toThrow(/firmame/i);
    });
  });

  describe("verifyWebhookSignature", () => {
    it("returns true for valid HMAC", () => {
      const body = '{"event":"signed","document_id":"abc"}';
      const secret = "webhook-secret";
      const expectedSig = createHmac("sha256", secret).update(body).digest("hex");

      const client = createFirmameClient({ apiKey: "x", sandbox: true, webhookSecret: secret });
      expect(client.verifyWebhookSignature(body, expectedSig)).toBe(true);
    });

    it("returns false for invalid HMAC", () => {
      const client = createFirmameClient({ apiKey: "x", sandbox: true, webhookSecret: "s" });
      expect(client.verifyWebhookSignature("body", "wrong-sig")).toBe(false);
    });
  });
});
