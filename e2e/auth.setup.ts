import { expect, test as setup } from "@playwright/test";
import { assertApiUsesTestDatabase, requestLibraryEmbeddings, resetE2eDatabase } from "./db";
import {
  ADMIN_EMAIL,
  ADMIN_STATE,
  CISO_EMAIL,
  CISO_STATE,
  REPORTER_EMAIL,
  REPORTER_STATE,
  WEB_URL,
} from "./env";
import { ensureE2eBucket } from "./storage";
import { greeting, submitKeycloakForm } from "./support";

// A fresh isms_test for every run: no organisation, no users, the shipped control library.
setup("reset the test database", async () => {
  await ensureE2eBucket();
  await resetE2eDatabase();
  // The worker embeds the fresh library while the earlier projects run (review needs it).
  await requestLibraryEmbeddings();
});

for (const [email, path] of [
  [ADMIN_EMAIL, ADMIN_STATE],
  [REPORTER_EMAIL, REPORTER_STATE],
  [CISO_EMAIL, CISO_STATE],
] as const) {
  setup(`sign in as ${email}`, async ({ page }) => {
    await page.goto("/");
    await submitKeycloakForm(page, email);
    await expect(page).toHaveURL(`${WEB_URL}/`);
    // The greeting, not just any heading: an error screen also has an h1, and then the
    // database check below would blame the wrong thing.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(greeting);
    await page.context().storageState({ path });
    if (email === ADMIN_EMAIL) await assertApiUsesTestDatabase(ADMIN_EMAIL);
  });
}
