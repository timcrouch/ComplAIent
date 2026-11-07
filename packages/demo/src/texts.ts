/** The plain-text words people of the sample company write. No AI wrote any of them. */

export const QUESTIONS = [
  "Which suppliers are affected?",
  "Does this also apply to the Riga office?",
  "How many customers could be affected?",
  "Who owns the system today?",
];

export const SAFEGUARDS = [
  "Antivirus on all laptops; yearly awareness training.",
  "Firewall at each site; access reviewed once a year.",
  "Nightly backups to a second location.",
  "Two-person sign-off for payments over EUR 10,000.",
];

export const TREATMENT_NOTES = [
  "Reduce the likelihood with technical controls and training.",
  "Close the gap this quarter, then check it at the next review.",
  "Move the exposure to the supplier contract and insurance where we can.",
  "Fix the root cause rather than the symptom.",
];

export const CONTROL_REASONS = [
  "Directly reduces the likelihood.",
  "Limits the damage if it happens.",
  "Required by the framework for this area.",
  "",
];

export const ACCEPT_NOTES = [
  "The cost of further controls is higher than the expected loss; accepted by the board's appetite.",
  "Accepted for this year; the system is replaced next spring.",
  "Residual exposure is small and covered by insurance.",
];

export const CONCERNS = [
  "The impact looks too low for customer data. Please reassess with Compliance.",
  "Which control covers the Frankfurt branch? Please add it before approval.",
  "The treatment note does not say who does what by when.",
  "Please set an expected score so we can see the benefit of the treatment.",
];

export const APPROVE_COMMENTS = [
  "Agreed. Please keep the actions on schedule.",
  "Approved; report progress at the next risk meeting.",
  "Fine for now. Revisit after the audit.",
];

export const ACTIONS: readonly (readonly [string, string])[] = [
  [
    "Roll out multi-factor sign-in",
    "Enable MFA for all affected accounts and check the exceptions.",
  ],
  ["Run a phishing exercise", "Send a test campaign and follow up with the people who clicked."],
  ["Patch the affected systems", "Apply the vendor update and confirm the version afterwards."],
  ["Test a restore from backup", "Restore one system end to end and record the time it took."],
  ["Review supplier access", "List every supplier account and remove those not needed."],
  ["Update the procedure", "Write the new steps into the procedure and brief the team."],
  ["Train the team", "Short session for everyone in the department, with attendance list."],
  ["Remove old data", "Delete records past their retention period and log what was deleted."],
];

export const DONE_NOTES = [
  "Done and checked.",
  "Completed; evidence filed with the control.",
  "Finished later than planned because of the audit, but complete.",
  "",
];

export const EVIDENCE_FILES = [
  { name: "access-review.csv", mime: "text/csv" },
  { name: "patch-report.txt", mime: "text/plain" },
  { name: "training-attendance.csv", mime: "text/csv" },
  { name: "restore-test-log.txt", mime: "text/plain" },
  { name: "supplier-assessment.txt", mime: "text/plain" },
  { name: "configuration-export.txt", mime: "text/plain" },
] as const;

/** A small, obviously sample evidence file. */
export function evidenceBody(
  fileName: string,
  control: string,
  risk: string,
  date: string,
): string {
  if (fileName.endsWith(".csv"))
    return [
      "item,checked_by,date,result",
      `${control},sample reviewer,${date},ok`,
      `${control} follow-up,sample reviewer,${date},ok`,
      "",
    ].join("\n");
  return [
    "SAMPLE EVIDENCE (generated for the Isarwerk Finanz AG sample, not a real record)",
    `Control: ${control}`,
    `Risk: ${risk}`,
    `Collected: ${date}`,
    "Result: checked, no exceptions found.",
    "",
  ].join("\n");
}

export const REQUEST_TEXTS = [
  "Please upload the latest report that shows this control working.",
  "We need this for the auditor's visit next month.",
  "A screenshot export or log extract is fine.",
];

export const CLOSE_NOTES = [
  "All actions done; the risk is now within appetite.",
  "Treated as planned. Evidence is on the controls.",
  "Closed after the controls were checked in the last test.",
];

export const REASSESS_REASONS = [
  "The supplier changed; the assessment needs a fresh look.",
  "A new incident at a peer firm suggests the likelihood has changed.",
  "Scope grew to the Riga office.",
];

export const REVIEW_NOTES = [
  "Still accurate. No change to the score.",
  "Reviewed with the owner; controls still in place.",
  "Checked after the annual audit; no change.",
];

export const SOA_APPLICABLE = [
  "Applies to our payments and lending services; covered by the risk assessment.",
  "Required for a regulated financial services firm.",
  "Applies at all three sites.",
  "Needed to protect customer and card data.",
];

export const SOA_NOT_APPLICABLE: Readonly<Record<string, string>> = {
  "A.8.30":
    "Not applicable: all software is built by our own team in Riga; no development is contracted out.",
  "A.7.6": "Not applicable: no area needs rules beyond the server room controls in A.7.2.",
  "A.7.12":
    "Not applicable: cabling in all three leased offices is the landlord's and outside our control; covered by the lease.",
};

export const TEST_METHODS = [
  "Sampled 25 accounts and compared them with the HR leaver list.",
  "Reviewed the configuration export against the baseline.",
  "Walked through the procedure with the team and checked the records.",
  "Restored one system from backup and timed it.",
];

export const TEST_NOTES = {
  effective: "Working as designed; no exceptions.",
  partially_effective: "Works for most systems; two exceptions found and assigned.",
  ineffective: "Not working: the setting was missing on several systems. Action raised.",
} as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** What happened in a narrative's month, read from the plan, so the text is true for any date. */
export type NarrativeFacts = {
  /** 0-11, UTC. */
  month: number;
  approved: boolean;
  treated: boolean;
  reviewed: boolean;
  /** Control tests in the month that were not effective; null when none were tested. */
  gaps: "none" | "one" | "several" | null;
  /** A risk was accepted at some point before the month ended. */
  accepted: boolean;
};

/**
 * A sample board narrative. No digits: the app's number guard (P7-R5) allows only the period's
 * figures, so the text is qualitative. Every clause follows from the facts; `variant` picks a
 * closing sentence.
 */
export function narrativeText(f: NarrativeFacts, variant: number): string {
  const month = MONTHS[f.month] ?? "This month";
  const opening =
    f.approved && f.treated
      ? `Risk management stayed on course in ${month}: risks were assessed and approved, and others were marked as treated.`
      : f.approved
        ? `Risk management stayed on course in ${month}: risks were assessed and approved.`
        : f.treated
          ? `${month} brought no new approvals, but some risks were marked as treated.`
          : `${month} was a quiet month for risk decisions.`;
  const reviews = f.reviewed ? "Periodic reviews of older risks were carried out." : null;
  const tests =
    f.gaps === "several"
      ? "Control tests found gaps, which now have actions."
      : f.gaps === "one"
        ? "A control test found a gap, which now has an action."
        : f.gaps === "none"
          ? "The controls tested this month worked as designed."
          : null;
  const closings = [
    "Attention remains on the open treatment actions.",
    f.accepted
      ? "The board is asked to note the accepted risks and the plan for the remaining open actions."
      : "The board is asked to note the plan for the remaining open actions.",
    "The next step is to keep reviews and treatment actions on schedule.",
  ];
  const closing = closings[variant % closings.length] ?? "";
  return ["Sample narrative:", opening, reviews, tests, closing]
    .filter((x) => x !== null)
    .join(" ");
}
