import "server-only";
import { z } from "zod";
import { env } from "./env";
import type { LoginState } from "./oidc";
import { getStore } from "./redis";
import { deriveKeys, seal, unseal } from "./seal";

const LOGIN_TTL_MS = 10 * 60 * 1000;
/** openid-client's randomState() is 32 random bytes in base64url (43 chars). */
export const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const schema = z.object({
  state: z.string(),
  codeVerifier: z.string(),
  nonce: z.string(),
  returnTo: z.string(),
  maxAge: z.number().int().nonnegative().optional(),
});

const key = (state: string): string => `oidc:${state}`;

/** Encrypted at rest: the PKCE verifier and nonce are login secrets. */
export async function saveLoginState(login: LoginState): Promise<void> {
  const { encryption } = deriveKeys(env().SESSION_SECRET);
  const k = key(login.state);
  await getStore().set(k, seal(encryption, JSON.stringify(login), k), LOGIN_TTL_MS);
}

/** Single use: GETDEL removes the state as it is read, so a callback cannot be replayed. */
export async function takeLoginState(state: string): Promise<LoginState | null> {
  if (!STATE_PATTERN.test(state)) return null;
  const k = key(state);
  const sealed = await getStore().getDel(k);
  if (sealed === null) return null;
  const plain = unseal(deriveKeys(env().SESSION_SECRET).encryption, sealed, k);
  if (plain === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(plain));
    if (!parsed.success || parsed.data.state !== state) return null;
    const { maxAge, ...rest } = parsed.data;
    return maxAge === undefined ? rest : { ...rest, maxAge };
  } catch {
    return null;
  }
}
