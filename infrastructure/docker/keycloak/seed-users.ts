// Idempotently creates the dev users in the `isms` realm through the Keycloak
// admin REST API. Existing users get their profile and password reset.

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional when the variables are already exported.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; copy .env.example to .env`);
  return value;
}

const REALM = "isms";
const baseUrl = new URL(required("OIDC_ISSUER_URL")).origin;
const password = required("DEV_USER_PASSWORD");
const mfaRequired = (process.env.KEYCLOAK_MFA_REQUIRED ?? "true") === "true";

type DevUser = {
  username: string;
  email?: string;
  firstName: string;
  lastName: string;
};

type KeycloakUser = { id: string; requiredActions?: string[] };
type KeycloakCredential = { type: string };

const devUser = (email: string, firstName: string, lastName: string): DevUser => ({
  username: email,
  email,
  firstName,
  lastName,
});

const DEV_USERS: DevUser[] = [
  devUser("admin@example.test", "Anna", "Admin"),
  devUser("ciso@example.test", "Carl", "Ciso"),
  devUser("owner@example.test", "Olga", "Owner"),
  devUser("approver@example.test", "Adam", "Approver"),
  devUser("reporter@example.test", "Rita", "Reporter"),
  devUser("auditor@example.test", "Arno", "Auditor"),
  // Dev/e2e only: no email, so the API rejects its tokens (tests the no-redirect-loop screen).
  { username: "noemail@example.test", firstName: "Nora", lastName: "Noemail" },
];

async function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${baseUrl}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed: HTTP ${response.status}`);
  }
  return response;
}

async function adminToken(): Promise<string> {
  const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: required("KEYCLOAK_ADMIN_USER"),
      password: required("KEYCLOAK_ADMIN_PASSWORD"),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`admin login failed: HTTP ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function upsertUser(token: string, user: DevUser): Promise<string> {
  const profile = {
    username: user.username,
    ...(user.email ? { email: user.email, emailVerified: true } : {}),
    enabled: true,
    firstName: user.firstName,
    lastName: user.lastName,
  };
  const found = (await (
    await request(token, `/users?username=${encodeURIComponent(user.username)}&exact=true`)
  ).json()) as KeycloakUser[];

  let id = found[0]?.id;
  let action = "updated";
  if (id) {
    await request(token, `/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(profile),
    });
  } else {
    const created = await request(token, "/users", {
      method: "POST",
      body: JSON.stringify(profile),
    });
    id = created.headers.get("location")?.split("/").pop();
    action = "created";
  }
  if (!id) throw new Error(`could not determine id for ${user.username}`);

  await request(token, `/users/${id}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({
      type: "password",
      value: password,
      temporary: false,
    }),
  });
  await reconcileUserMfa(token, id);
  return action;
}

/**
 * Keycloak only copies default required actions onto a user when that user is created. The dev
 * accounts normally predate policy changes, so reconcile them explicitly on every seed run.
 */
async function reconcileUserMfa(token: string, id: string): Promise<void> {
  const state = (await (await request(token, `/users/${id}`)).json()) as KeycloakUser;
  const credentials = (await (
    await request(token, `/users/${id}/credentials`)
  ).json()) as KeycloakCredential[];
  const actions = new Set(state.requiredActions ?? []);
  const before = [...actions].sort().join(",");

  if (mfaRequired) {
    if (!credentials.some((credential) => credential.type === "otp")) {
      actions.add("CONFIGURE_TOTP");
    } else if (!credentials.some((credential) => credential.type === "recovery-authn-codes")) {
      actions.add("CONFIGURE_RECOVERY_AUTHN_CODES");
    }
  } else {
    // CI assigns MFA to a disposable identity in the browser test. Its shared seeded identities
    // must not inherit a pending action from a developer realm previously run in required mode.
    actions.delete("CONFIGURE_TOTP");
    actions.delete("CONFIGURE_RECOVERY_AUTHN_CODES");
  }

  const requiredActions = [...actions];
  if (requiredActions.sort().join(",") !== before) {
    await request(token, `/users/${id}`, {
      method: "PUT",
      body: JSON.stringify({ requiredActions }),
    });
  }

  const verified = (await (await request(token, `/users/${id}`)).json()) as KeycloakUser;
  if (
    mfaRequired &&
    !credentials.some((credential) => credential.type === "otp") &&
    !verified.requiredActions?.includes("CONFIGURE_TOTP")
  ) {
    throw new Error(`Keycloak user ${id} is missing mandatory TOTP enrollment`);
  }
}

type UserProfileConfig = { attributes: { name: string; required?: unknown }[] };

/**
 * Dev realm only: Keycloak's default user profile requires `email`, so a user without one is
 * stopped at "Update Account Information" instead of being signed in. The no-email dev user
 * needs to reach the app, whose API then rejects the token.
 */
async function allowUsersWithoutEmail(token: string): Promise<void> {
  const config = (await (await request(token, "/users/profile")).json()) as UserProfileConfig;
  const email = config.attributes.find((attribute) => attribute.name === "email");
  if (email?.required === undefined) return;
  delete email.required;
  await request(token, "/users/profile", {
    method: "PUT",
    body: JSON.stringify(config),
  });
  console.log("  email is optional in the dev realm's user profile");
}

/** The realm import runs only on a fresh volume, so the sign-in page name is applied here too. */
async function brandRealm(token: string): Promise<void> {
  await request(token, "", {
    method: "PUT",
    body: JSON.stringify({
      displayName: "ComplAIent ISMS",
      displayNameHtml: '<strong>Compl<span style="color:#a99dff">AI</span>ent</strong> ISMS',
      loginTheme: "complaient",
    }),
  });
  console.log("  sign-in page uses the ComplAIent theme");
}

type RequiredAction = {
  alias: string;
  name: string;
  providerId: string;
  enabled: boolean;
  defaultAction: boolean;
  priority: number;
  config?: Record<string, string>;
};

type AuthenticationExecution = {
  id: string;
  displayName: string;
  requirement: string;
};

/**
 * Phase 1 MFA for the local realm. Every user must register a TOTP authenticator, and
 * successful registration immediately continues to recovery-code generation. Keycloak's
 * imported browser flow includes recovery codes but leaves that authenticator disabled.
 * Reconcile both settings here because realm import only runs against a fresh volume.
 */
async function configureMfa(token: string): Promise<void> {
  const actions = (await (
    await request(token, "/authentication/required-actions")
  ).json()) as RequiredAction[];

  const updateAction = async (
    alias: string,
    update: Pick<RequiredAction, "enabled" | "defaultAction"> & {
      config?: Record<string, string>;
    },
  ): Promise<void> => {
    const action = actions.find((candidate) => candidate.alias === alias);
    if (!action) throw new Error(`Keycloak required action ${alias} was not found`);
    await request(token, `/authentication/required-actions/${encodeURIComponent(alias)}`, {
      method: "PUT",
      body: JSON.stringify({ ...action, ...update }),
    });
  };

  await updateAction("CONFIGURE_TOTP", {
    enabled: true,
    defaultAction: mfaRequired,
    config: { "add-recovery-codes": "true" },
  });
  await updateAction("CONFIGURE_RECOVERY_AUTHN_CODES", {
    enabled: true,
    defaultAction: false,
  });

  const executions = (await (
    await request(token, "/authentication/flows/browser/executions")
  ).json()) as AuthenticationExecution[];
  const recoveryCodes = executions.find(
    (execution) => execution.displayName === "Recovery Authentication Code Form",
  );
  if (!recoveryCodes) {
    throw new Error("Keycloak recovery-code browser authenticator was not found");
  }
  if (recoveryCodes.requirement !== "ALTERNATIVE") {
    await request(token, "/authentication/flows/browser/executions", {
      method: "PUT",
      body: JSON.stringify({
        id: recoveryCodes.id,
        requirement: "ALTERNATIVE",
      }),
    });
  }

  console.log(
    mfaRequired
      ? "  MFA requires TOTP enrollment and recovery-code generation"
      : "  MFA enrollment is available but not mandatory (automated-test mode)",
  );
}

const token = await adminToken();
await brandRealm(token);
await configureMfa(token);
await allowUsersWithoutEmail(token);
console.log(`Seeding ${DEV_USERS.length} users in realm "${REALM}"`);
for (const user of DEV_USERS) {
  const action = await upsertUser(token, user);
  console.log(`  ${action.padEnd(7)} ${user.username} (${user.firstName} ${user.lastName})`);
}
