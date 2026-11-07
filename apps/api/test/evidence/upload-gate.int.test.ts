import { type IncomingHttpHeaders, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceDto } from "@isms/contracts";
import { EvidenceService } from "../../src/evidence/evidence.service.js";
import { type Who, db } from "../risks/harness.js";
import { MAX_BYTES, evidenceHarness, objectKeys } from "./harness.js";

const h = evidenceHarness();
beforeAll(async () => {
  await h.start();
  const server = h.server();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
beforeEach(() => h.reset());
afterAll(() => h.stop());

type Outcome = { status: number; headers: IncomingHttpHeaders; closed: boolean };

/**
 * Sends the headers and the first bytes of an upload, and never finishes the body unless
 * `end` is set. A server that waited for the body would never answer (the test times out).
 */
async function rawUpload(
  path: string,
  who: Who | null,
  o: { declared?: number; send: Buffer; end?: boolean },
): Promise<Outcome> {
  const { port } = h.server().address() as AddressInfo;
  const headers: Record<string, string> = { "content-type": "application/octet-stream" };
  if (who !== null) headers["authorization"] = await h.auth(who);
  if (o.declared !== undefined) headers["content-length"] = String(o.declared);
  return new Promise<Outcome>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path, headers });
    req.on("error", reject);
    req.on("response", (res) => {
      res.resume();
      const socket = res.socket;
      const timer = setTimeout(() => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, closed: false });
        req.destroy();
      }, 3000);
      socket.on("close", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, closed: true });
      });
    });
    req.write(o.send);
    if (o.end === true) req.end();
  });
}

const query = (controlId: string) =>
  `fileName=policy.pdf&mimeType=application%2Fpdf&controlIds=${controlId}`;
const head = Buffer.from("%PDF-1.7\n");

describe("uploads are refused before the body is read", () => {
  it("an unauthenticated upload is 401 and the connection is closed", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const out = await rawUpload(`/api/v1/risks/${riskId}/evidence?${query(ctl)}`, null, {
      declared: MAX_BYTES,
      send: head,
    });
    expect(out.status).toBe(401);
    expect(out.headers["connection"]).toBe("close");
    expect(out.closed).toBe(true);
  });

  it("a caller without the permission is 403, one out of scope 404, without the body", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const path = `/api/v1/risks/${riskId}/evidence?${query(ctl)}`;
    const carl = await rawUpload(path, "carl", { declared: MAX_BYTES, send: head });
    expect([carl.status, carl.closed]).toEqual([403, true]);
    const olga = await rawUpload(path, "olga", { declared: MAX_BYTES, send: head });
    expect([olga.status, olga.closed]).toEqual([404, true]);
    const notAccepted = await rawUpload(
      `/api/v1/risks/${riskId}/evidence?${query("00000000-0000-7000-8000-000000000000")}`,
      "cora",
      { declared: MAX_BYTES, send: head },
    );
    expect([notAccepted.status, notAccepted.closed]).toEqual([409, true]);
  });

  it("someone else's task is 404 without the body", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const created = await h.post(
      `/api/v1/risks/${riskId}/evidence-requests`,
      {
        assigneeId: h.userIds.carl,
        controlId: ctl,
        title: "Restore test",
        description: "The report.",
        dueDate: null,
      },
      "cora",
    );
    const taskId = (created.body as { id: string }).id;
    const out = await rawUpload(
      `/api/v1/tasks/${taskId}/evidence?fileName=a.pdf&mimeType=application%2Fpdf`,
      "sam",
      { declared: MAX_BYTES, send: head },
    );
    expect([out.status, out.closed]).toEqual([404, true]);
  });

  it("a declared length over the limit is 413 before reading", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const out = await rawUpload(`/api/v1/risks/${riskId}/evidence?${query(ctl)}`, "cora", {
      declared: MAX_BYTES + 1,
      send: head,
    });
    expect([out.status, out.closed]).toEqual([413, true]);
  });

  it("a body over the limit without a declared length is 413", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const out = await rawUpload(`/api/v1/risks/${riskId}/evidence?${query(ctl)}`, "cora", {
      send: Buffer.concat([head, Buffer.alloc(MAX_BYTES + 1024, 0x41)]),
      end: true,
    });
    expect([out.status, out.closed]).toEqual([413, true]);
  });
});

describe("a client that disconnects before its file is read", () => {
  it("the upload settles, and leaves no row and no object", async () => {
    const { riskId, ctl } = await h.riskWithAcceptedControl();
    const before = await objectKeys();
    // Slow the pre-read checks so the client is gone before the service reads the body.
    type Checks = { accepted: (...args: unknown[]) => Promise<unknown> };
    const proto = EvidenceService.prototype as unknown as Checks;
    const accepted = proto.accepted;
    const slow = vi.spyOn(proto, "accepted").mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return accepted.apply(this, args);
    });
    // Kept unbound on purpose: it is re-applied to the service instance below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const upload = EvidenceService.prototype.upload;
    let outcome: Promise<string> | undefined;
    const spy = vi.spyOn(EvidenceService.prototype, "upload").mockImplementation(function (
      this: EvidenceService,
      ...args: Parameters<EvidenceService["upload"]>
    ): Promise<EvidenceDto> {
      const p = upload.apply(this, args);
      outcome = p.then(
        () => "resolved",
        () => "rejected",
      );
      return p;
    });
    try {
      const { port } = h.server().address() as AddressInfo;
      const req = httpRequest({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: `/api/v1/risks/${riskId}/evidence?${query(ctl)}`,
        headers: {
          authorization: await h.auth("cora"),
          "content-type": "application/octet-stream",
          "content-length": String(MAX_BYTES),
        },
      });
      req.on("error", () => undefined);
      req.write(head);
      await vi.waitFor(() => {
        expect(outcome).toBeDefined();
      });
      req.destroy();
      const result = await Promise.race([
        outcome,
        new Promise((resolve) =>
          setTimeout(() => {
            resolve("hung");
          }, 3000),
        ),
      ]);
      expect(result).toBe("rejected");
      expect(await db.evidence.count()).toBe(0);
      expect(await objectKeys()).toEqual(before);
    } finally {
      slow.mockRestore();
      spy.mockRestore();
    }
  });
});
