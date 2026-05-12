import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@navora/shared";
import type { NMEnvelope } from "@navora/protocol";
import { NMAdapter, type NativeMessagingBridge } from "../src/nm/nm-adapter";

describe("NMAdapter", () => {
  let bridge: NativeMessagingBridge;

  beforeEach(() => {
    bridge = {
      sendRequest: vi.fn(),
      cancelAllRequests: vi.fn(),
    };
  });

  it("delegates with request_id correlation (initialize ping)", async () => {
    vi.mocked(bridge.sendRequest!).mockImplementation(async (_pid, req, opts) => {
      expect(opts?.requestId).toBeDefined();
      expect(req.method).toBe("ping");
      const envelope: NMEnvelope = {
        kind: "response",
        request_id: opts!.requestId!,
        success: true,
        result: { ok: true },
      };
      return ok(envelope);
    });

    const adapter = new NMAdapter(bridge, "p1", { timeout: 5000 });
    const r = await adapter.initialize();
    expect(r.ok).toBe(true);
  });

  it("surfaces bridge errors", async () => {
    vi.mocked(bridge.sendRequest!).mockResolvedValue(err(new Error("network down")));

    const adapter = new NMAdapter(bridge, "p1");
    const r = await adapter.getTabs();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("network down");
  });

  it("maps unsuccessful NM response to error", async () => {
    const envelope: NMEnvelope = {
      kind: "response",
      request_id: "rid",
      success: false,
      error: { code: "X", message: "bad" },
    };
    vi.mocked(bridge.sendRequest!).mockResolvedValue(ok(envelope));

    const adapter = new NMAdapter(bridge, "p1");
    const r = await adapter.getTabs();
    expect(r.ok).toBe(false);
  });

  it("dispose invokes cancelAllRequests", async () => {
    const adapter = new NMAdapter(bridge, "p1");
    await adapter.dispose();
    expect(bridge.cancelAllRequests).toHaveBeenCalled();
  });
});
