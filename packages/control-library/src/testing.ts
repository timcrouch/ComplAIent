import type { LibraryContent } from "./schema.js";

/** A small, valid library for tests. Not shipped content. */
export const FIXTURE_LIBRARY: LibraryContent = {
  libraryVersion: "2026.11.0-test",
  frameworks: [
    {
      framework: {
        key: "iso27001",
        name: "ISO/IEC 27001",
        publisher: "ISO/IEC",
        summary: "An international standard for managing information security.",
      },
      version: { key: "iso27001-2022", label: "2022" },
      groups: [
        { key: "A.5", title: "Organisational controls" },
        { key: "A.8", title: "Technological controls" },
      ],
      requirements: [
        {
          ref: "A.5.1",
          title: "Leadership sets and approves the organisation's security rules.",
          group: "A.5",
        },
        {
          ref: "A.8.13",
          group: "A.8",
          title: "Important information is copied regularly and can be restored when needed.",
        },
      ],
    },
    {
      framework: {
        key: "gdpr",
        name: "GDPR",
        publisher: "European Union",
        summary: "The EU regulation on protecting personal data.",
      },
      version: { key: "gdpr-2016-679", label: "Regulation (EU) 2016/679" },
      requirements: [
        {
          ref: "Art. 32",
          title: "Personal data is protected by security measures that suit the risk.",
        },
      ],
    },
  ],
  controls: [
    {
      code: "GOV-01",
      title: "Agree and publish your security rules",
      description: "Leadership agrees a short set of security rules and shares them with everyone.",
      guidance: ["Write the rules in plain language.", "Review them once a year."],
      category: "governance",
      mappings: [{ framework: "iso27001-2022", ref: "A.5.1" }],
    },
    {
      code: "RES-01",
      title: "Back up important data and test restores",
      description:
        "Keep regular backups of important information and check that you can restore them.",
      guidance: ["List what must be backed up.", "Try a restore at least twice a year."],
      category: "resilience",
      mappings: [
        { framework: "iso27001-2022", ref: "A.8.13" },
        { framework: "gdpr-2016-679", ref: "Art. 32" },
      ],
    },
    {
      code: "ACC-01",
      title: "Give people only the access they need",
      description:
        "People get the access their work needs, and it is removed when they no longer need it.",
      guidance: ["Review who has access every quarter."],
      category: "access",
      mappings: [{ framework: "gdpr-2016-679", ref: "Art. 32" }],
    },
  ],
};
