import type { SamplePerson, SampleScope } from "./types.js";

/** The fixed seed of the sample year. */
export const SAMPLE_SEED = 20_261_106;

export const SAMPLE_ORG_NAME = "Isarwerk Finanz AG (sample)";
/** The reserved sample domain (RFC 2606): every sample person's email ends with it. */
export const SAMPLE_DOMAIN = "@example.test";

export const SAMPLE_ORGANISATION = {
  name: SAMPLE_ORG_NAME,
  description:
    "A fictional mid-sized German payments and lending firm, used to show and train the app. " +
    "Head office in Munich, a branch in Frankfurt and a development centre in Riga.",
  approximateHeadcount: 640,
  reviewIntervalMonths: 12,
} as const;

export const SAMPLE_SITES = [
  { key: "munich", name: "Munich", countryCode: "DE" },
  { key: "frankfurt", name: "Frankfurt", countryCode: "DE" },
  { key: "riga", name: "Riga", countryCode: "LV" },
] as const;

export const SAMPLE_DEPARTMENTS = [
  { key: "it-operations", name: "IT Operations" },
  { key: "information-security", name: "Information Security" },
  { key: "finance", name: "Finance" },
  { key: "hr", name: "HR" },
  { key: "customer-service", name: "Customer Service" },
  { key: "software-development", name: "Software Development" },
  { key: "compliance", name: "Compliance" },
  { key: "facilities", name: "Facilities" },
] as const;

/** Framework versions confirmed in scope, all from the shipped control library. */
export const SAMPLE_FRAMEWORKS = ["iso27001-2022", "nis2-2022-2555", "gdpr-2016-679"] as const;

/** A risk is above appetite when likelihood × impact is greater than this (the "balanced" preset). */
export const SAMPLE_APPETITE_THRESHOLD = 9;

/** The installation's default levels (apps/api/src/organisation/default-risk-scale.ts). */
export const SAMPLE_SCALE_LEVELS = {
  likelihood: [
    { value: 1, label: "Rare", description: "Hardly ever: less than once in ten years." },
    {
      value: 2,
      label: "Unlikely",
      description: "Could happen, but not expected: about once in five to ten years.",
    },
    { value: 3, label: "Possible", description: "Might happen every few years." },
    { value: 4, label: "Likely", description: "Will probably happen this year." },
    { value: 5, label: "Almost certain", description: "Expected to happen several times a year." },
  ],
  impact: [
    { value: 1, label: "Negligible", description: "Barely noticeable. Sorted out within a day." },
    { value: 2, label: "Minor", description: "Some disruption or cost, no lasting harm." },
    {
      value: 3,
      label: "Moderate",
      description: "Noticeable harm to customers, money or operations, but recoverable.",
    },
    {
      value: 4,
      label: "Major",
      description: "Serious harm: regulators involved, large losses or many people affected.",
    },
    {
      value: 5,
      label: "Severe",
      description: "Threatens the organisation or causes lasting harm to people.",
    },
  ],
} as const;

const ORG: SampleScope = { kind: "organisation" };
const site = (s: string): SampleScope => ({ kind: "site", site: s });
const dept = (d: string): SampleScope => ({ kind: "department", department: d });

const person = (
  key: string,
  local: string,
  displayName: string,
  signsIn: boolean,
  roles: SamplePerson["roles"],
): SamplePerson => ({ key, email: `${local}${SAMPLE_DOMAIN}`, displayName, signsIn, roles });

/**
 * The six dev sign-in users (the Keycloak seed's accounts, spec §5.3 roles), then ten fictional
 * people with German placeholder names who own risks and do actions but never sign in.
 */
export const SAMPLE_PEOPLE: readonly SamplePerson[] = Object.freeze([
  person("anna", "admin", "Anna Admin", true, [{ role: "administrator", scope: ORG }]),
  person("carl", "ciso", "Carl Ciso", true, [{ role: "ciso", scope: ORG }]),
  person("olga", "owner", "Olga Owner", true, [{ role: "risk_owner", scope: site("munich") }]),
  person("adam", "approver", "Adam Approver", true, [{ role: "risk_approver", scope: ORG }]),
  person("rita", "reporter", "Rita Reporter", true, [{ role: "contributor", scope: ORG }]),
  person("arno", "auditor", "Arno Auditor", true, [{ role: "auditor", scope: ORG }]),
  person("max", "max.mustermann", "Max Mustermann", false, [
    { role: "risk_owner", scope: dept("it-operations") },
  ]),
  person("erika", "erika.mustermann", "Erika Mustermann", false, [
    { role: "risk_owner", scope: dept("information-security") },
  ]),
  person("bernd", "bernd.beispiel", "Bernd Beispiel", false, [
    { role: "risk_owner", scope: site("frankfurt") },
  ]),
  person("lena", "lena.lorem", "Lena Lorem", false, [
    { role: "risk_owner", scope: site("riga") },
    { role: "risk_owner", scope: dept("software-development") },
  ]),
  person("paul", "paul.platzhalter", "Paul Platzhalter", false, [
    { role: "risk_owner", scope: dept("finance") },
  ]),
  person("fritz", "fritz.fiktiv", "Fritz Fiktiv", false, [
    { role: "risk_owner", scope: dept("facilities") },
  ]),
  person("ida", "ida.ipsum", "Ida Ipsum", false, [
    { role: "risk_owner", scope: dept("compliance") },
  ]),
  person("nina", "nina.nachname", "Nina Nachname", false, [
    { role: "risk_owner", scope: dept("hr") },
    { role: "risk_owner", scope: dept("customer-service") },
  ]),
  person("theo", "theo.testfall", "Theo Testfall", false, [{ role: "contributor", scope: ORG }]),
  person("ben", "ben.blindtext", "Ben Blindtext", false, [
    { role: "risk_approver", scope: site("frankfurt") },
  ]),
]);

export const personByKey = (key: string): SamplePerson => {
  const p = SAMPLE_PEOPLE.find((x) => x.key === key);
  if (!p) throw new Error(`unknown sample person ${key}`);
  return p;
};
