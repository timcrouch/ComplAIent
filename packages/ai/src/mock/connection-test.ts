/** Mock reply for the admin connection test (schema `{ ok: boolean }`). */
export function connectionTestReply(): string {
  return JSON.stringify({ ok: true });
}
