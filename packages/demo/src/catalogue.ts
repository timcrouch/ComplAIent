import type { AssetRef } from "./types.js";

/** A kind of risk the sample company reports, with a typical first assessment. */
export type RiskTemplate = {
  title: string;
  scenario: string;
  threat: string;
  consequence: string;
  safeguards: string;
  assets: AssetRef[];
  /** Control codes from the shipped library that treat it, best first. */
  controls: string[];
  likelihood: number;
  impact: number;
  department: string;
  /** Raised after the phishing incident (the busy weeks). */
  incident?: true;
};

export const a = (name: string, type: AssetRef["type"]): AssetRef => ({ name, type });
export const PAY = a("Payments platform", "application");
export const LEND = a("Lending portal", "application");
export const CRM = a("Customer records", "information");
export const MAIL = a("Email and collaboration suite", "service");
export const AD = a("Directory and sign-in service", "service");
export const LAPTOPS = a("Staff laptops", "device");
export const DC = a("Munich server room", "facility");
export const CLOUD = a("Cloud hosting account", "service");
export const LEDGER = a("General ledger", "application");
export const HRDATA = a("Employee files", "information");
export const CODE = a("Source code repositories", "information");
export const BACKUP = a("Backup storage", "service");

export const t = (
  title: string,
  threat: string,
  consequence: string,
  scenario: string,
  assets: AssetRef[],
  controls: string[],
  [likelihood, impact]: [number, number],
  department: string,
  incident?: true,
): RiskTemplate => ({
  title,
  scenario,
  threat,
  consequence,
  safeguards: "",
  assets,
  controls,
  likelihood,
  impact,
  department,
  ...(incident ? { incident } : {}),
});

/** Above the appetite threshold (score > 9) when first assessed. */
export const HIGH_RISKS: readonly RiskTemplate[] = [
  t(
    "Phishing steals payment staff passwords",
    "Targeted phishing emails",
    "Fraudulent payments and a reportable breach",
    "A convincing email lures payment operators to a fake sign-in page and their passwords are reused by attackers.",
    [MAIL, PAY, AD],
    ["PPL-03", "ACC-03", "INC-02"],
    [4, 4],
    "information-security",
    true,
  ),
  t(
    "Ransomware encrypts file servers",
    "Ransomware delivered by email or a remote access gap",
    "Days without payments processing",
    "Malware spreads from one infected laptop to the file servers and encrypts them overnight.",
    [LAPTOPS, BACKUP, DC],
    ["OPS-02", "RES-03", "INC-03"],
    [3, 5],
    "it-operations",
    true,
  ),
  t(
    "Business email compromise of finance mailbox",
    "An attacker in a finance mailbox",
    "Supplier payments diverted to attacker accounts",
    "An attacker reads a finance mailbox for weeks and changes a supplier's bank details on an invoice.",
    [MAIL, LEDGER],
    ["ACC-03", "GOV-03", "PPL-03"],
    [3, 4],
    "finance",
    true,
  ),
  t(
    "Stolen session tokens bypass MFA",
    "Session hijacking after phishing",
    "Attacker access to the lending portal back office",
    "A phishing proxy captures a signed-in session and replays it from abroad.",
    [AD, LEND],
    ["ACC-03", "OPS-10", "INC-02"],
    [3, 4],
    "information-security",
    true,
  ),
  t(
    "Unpatched VPN appliance",
    "Exploitation of a known VPN flaw",
    "Remote attacker inside the office network",
    "The VPN appliance runs a version with a published exploit for three weeks.",
    [a("Remote access VPN", "service")],
    ["OPS-03", "OPS-04"],
    [4, 4],
    "it-operations",
  ),
  t(
    "Single database administrator for core banking data",
    "Key person dependency",
    "Long outage when the one administrator is absent",
    "Only one person can restore or tune the core payments database.",
    [PAY],
    ["RES-04", "GOV-02"],
    [3, 4],
    "it-operations",
  ),
  t(
    "Cloud storage bucket open to the internet",
    "Misconfiguration",
    "Customer documents exposed publicly",
    "A storage bucket for loan documents is created without access restrictions.",
    [CLOUD, CRM],
    ["OPS-04", "SUP-05", "AST-04"],
    [3, 5],
    "software-development",
  ),
  t(
    "Card data in application logs",
    "Developers log full request bodies",
    "PCI and GDPR breach on every log access",
    "Debug logging writes card numbers into log files kept for a year.",
    [PAY, CODE],
    ["DEV-04", "OPS-06", "PRV-05"],
    [4, 3],
    "software-development",
  ),
  t(
    "Payment processor outage without fallback",
    "Failure at the card processor",
    "Merchants cannot take payments",
    "The single card processor has a day-long outage and no second route exists.",
    [PAY, a("Card processor link", "service")],
    ["SUP-04", "RES-01", "RES-04"],
    [3, 4],
    "it-operations",
  ),
  t(
    "Insider exports customer lists",
    "A leaving employee copies data",
    "Loss of customers and a GDPR breach",
    "A sales employee downloads the customer list to a personal drive before leaving.",
    [CRM],
    ["ACC-01", "AST-03", "PPL-06"],
    [3, 4],
    "customer-service",
  ),
  t(
    "Backups never tested for restore",
    "Untested recovery",
    "Data lost when a restore is finally needed",
    "Nightly backups run, but nobody has restored one in two years.",
    [BACKUP],
    ["RES-03", "RES-01"],
    [4, 4],
    "it-operations",
  ),
  t(
    "Administrator accounts without MFA",
    "Password guessing and reuse",
    "Full control of the directory by an attacker",
    "Twelve administrator accounts still sign in with a password alone.",
    [AD],
    ["ACC-03", "ACC-05"],
    [4, 5],
    "information-security",
    true,
  ),
  t(
    "Lending decisions without four-eyes check",
    "Error or fraud by one person",
    "Loans approved outside policy",
    "One credit officer can approve and pay out a loan alone.",
    [LEND],
    ["GOV-03", "ACC-01"],
    [3, 4],
    "compliance",
  ),
  t(
    "Supplier with remote access not vetted",
    "Compromise through a supplier",
    "Attacker access via a trusted connection",
    "A small IT supplier has standing remote access to the server room systems.",
    [a("Supplier remote access", "service"), DC],
    ["SUP-01", "SUP-02", "ACC-05"],
    [3, 4],
    "it-operations",
  ),
  t(
    "Incident reporting deadlines missed",
    "Slow escalation",
    "Fines under NIS2 and GDPR",
    "A significant incident is found but reported to the authority after the deadline.",
    [a("Incident register", "information")],
    ["INC-01", "INC-06"],
    [3, 4],
    "compliance",
    true,
  ),
  t(
    "Fake CEO calls to the payments desk",
    "Voice fraud",
    "Urgent payments released to fraudsters",
    "A caller imitating the CEO pressures the payments desk to release an urgent transfer.",
    [PAY],
    ["PPL-03", "GOV-03"],
    [4, 3],
    "finance",
    true,
  ),
];
