import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type HealthServer = {
  address(): AddressInfo;
  close(): Promise<void>;
};

/** Liveness only: `GET /healthz` answers 200 while the process is running. */
export function startHealthServer(port: number): Promise<HealthServer> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      resolve({
        address: () => server.address() as AddressInfo,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => {
              if (err) fail(err);
              else done();
            });
          }),
      });
    });
  });
}
