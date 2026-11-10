// Keycloak 26.8's keycloak.v2 TOTP template points both visible labels at
// "form-vertical-name" instead of their inputs. Keep the upstream template and repair the
// associations after it renders so upgrades continue to inherit Keycloak's authentication flow.
document.addEventListener("DOMContentLoaded", () => {
  for (const input of document.querySelectorAll(
    "#kc-totp-settings-form input[id]:not([type='hidden'])",
  )) {
    const label = input.closest(".pf-v5-c-form__group")?.querySelector("label");
    if (label) label.htmlFor = input.id;
  }

  if (document.body.dataset.pageId === "login-login-config-totp") {
    const form = document.querySelector("#kc-totp-settings-form");
    const steps = document.querySelector("#kc-totp-settings");
    if (form && !form.querySelector(".complaient-setup-intro")) {
      const intro = document.createElement("div");
      intro.className = "complaient-setup-intro";
      intro.innerHTML =
        "<h2>Confirm your authenticator</h2><p>Enter the current code from your app to finish securing your account.</p>";
      form.prepend(intro);
    }
    steps?.setAttribute("aria-label", "Authenticator setup steps");
  }

  if (document.body.dataset.pageId === "login-login-otp") {
    const title = document.querySelector("#kc-page-title");
    const input = document.querySelector("#otp");
    const attemptedUsername = document.querySelector("#kc-attempted-username");
    if (title) title.textContent = "Verify it’s you";
    if (title?.parentElement && !document.querySelector("#complaient-otp-intro")) {
      const intro = document.createElement("p");
      intro.id = "complaient-otp-intro";
      intro.textContent = "Enter the code from your authenticator app to continue securely.";
      title.insertAdjacentElement("afterend", intro);
    }
    input?.setAttribute("aria-describedby", "complaient-otp-intro");
    attemptedUsername?.setAttribute("aria-label", "Account");
  }

  if (document.body.dataset.pageId === "login-select-authenticator") {
    const title = document.querySelector("#kc-page-title");
    const attemptedUsername = document.querySelector("#kc-attempted-username");
    const methods = document.querySelectorAll(".select-auth-box-parent");
    const methodCopy = [
      {
        title: "Authenticator app",
        description: "Use the current 6-digit code from your authenticator app.",
      },
      {
        title: "Recovery code",
        description: "Use one unused code from the recovery list you saved.",
      },
    ];

    if (title) title.textContent = "Choose a verification method";
    if (title?.parentElement && !document.querySelector("#complaient-method-intro")) {
      const intro = document.createElement("p");
      intro.id = "complaient-method-intro";
      intro.textContent = "Select the secure method you have available right now.";
      title.insertAdjacentElement("afterend", intro);
    }
    attemptedUsername?.setAttribute("aria-label", "Account");

    methods.forEach((method, index) => {
      const copy = methodCopy[index];
      if (copy) {
        const heading = method.querySelector(".select-auth-box-headline");
        const description = method.querySelector(".select-auth-box-desc");
        if (heading) heading.textContent = copy.title;
        if (description) description.textContent = copy.description;
      }
      method.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          method.click();
        }
      });
    });
  }
});
