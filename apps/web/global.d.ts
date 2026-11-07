import type messages from "./messages/index";

// Type-checked message keys: a missing or misspelt key is a compile error.
declare module "next-intl" {
  interface AppConfig {
    Locale: "en";
    Messages: typeof messages;
  }
}
