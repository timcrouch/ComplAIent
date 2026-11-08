import type {
  AiActRole,
  AiObligationKey,
  AiObligationStatus,
  AiSystemStatus,
  ClassificationAnswers,
} from "@isms/domain";

/** The sample's EU AI Act framework version, put in scope when the module is turned on. */
export const SAMPLE_AI_ACT_FRAMEWORK = "eu-ai-act-2024-1689";

/** Days before today the administrator turns the module on. */
export const AI_ACT_ENABLED_DAYS_AGO = 150;

/** One piece of work on an obligation: its new status and note, by Carl Ciso. */
export type SampleObligationWork = {
  daysAgo: number;
  obligation: AiObligationKey;
  status: AiObligationStatus;
  note: string;
};

/**
 * One AI system of the sample register. Carl Ciso adds, classifies and works on every system,
 * and owns them all: the sample's risk owners are site- or department-scoped, and a scoped
 * assignment never grants aiact.read or aiact.manage (#16 §2), so he is the only sample person
 * who could. The department shows the business side. Classification is always `manual`: the
 * sample has no AI interactions (Plan 9).
 */
export type SampleAiSystem = {
  key: string;
  profile: {
    name: string;
    description: string;
    intendedPurpose: string;
    role: AiActRole;
    supplier: string | null;
    model: string | null;
    usesGeneralPurposeModel: boolean;
    status: AiSystemStatus;
    /** A person key. */
    owner: string;
    /** A department key. */
    department: string | null;
  };
  answers: ClassificationAnswers;
  /** Added this many days before today, and classified the same day. */
  createdDaysAgo: number;
  /** Obligation work, oldest first. Keys must be among those the classification opens. */
  work: readonly SampleObligationWork[];
  /** Linked to the first sample risk with one of these titles (best first), if any. */
  linkRisk?: { daysAgo: number; titles: readonly string[] };
};

const ANSWERS = {
  isAiSystem: true,
  prohibitedPractices: [],
  annexISafetyComponent: false,
  annexIIIAreas: [],
  profilesPeople: null,
  derogation: null,
  transparency: [],
} as const satisfies ClassificationAnswers;

/** The four systems, in the order they are added (spec #16 §8). */
export const SAMPLE_AI_SYSTEMS: readonly SampleAiSystem[] = [
  {
    key: "credit-scoring",
    profile: {
      name: "Credit scoring engine",
      description:
        "Scores consumer loan applications from credit bureau data, account history and the " +
        "application form. Runs inside the lending portal.",
      intendedPurpose:
        "Assess the creditworthiness of private applicants for consumer loans and propose " +
        "approve, decline or manual review. A credit officer makes every final decision.",
      role: "deployer",
      supplier: "Beispiel Scoring GmbH (fictional)",
      model: "Vendor scoring engine v4",
      usesGeneralPurposeModel: false,
      status: "in_use",
      owner: "carl",
      department: "finance",
    },
    answers: {
      ...ANSWERS,
      annexIIIAreas: ["creditworthiness"],
      profilesPeople: true,
      derogation: "none",
    },
    createdDaysAgo: 148,
    work: [
      {
        daysAgo: 138,
        obligation: "ai_literacy",
        status: "in_progress",
        note: "Credit officers and the scoring team are booked on the AI literacy course.",
      },
      {
        daysAgo: 131,
        obligation: "assign_human_oversight",
        status: "met",
        note:
          "Two senior credit officers review every declined or borderline application. " +
          "Named in the credit policy, with the authority to override the score.",
      },
      {
        daysAgo: 124,
        obligation: "use_per_instructions",
        status: "met",
        note: "Configuration checked against the supplier's instructions for use, release 4.2.",
      },
      {
        daysAgo: 117,
        obligation: "dpia_where_required",
        status: "met",
        note: "The DPIA for consumer lending now covers the scoring engine; the DPO signed it off.",
      },
      {
        daysAgo: 103,
        obligation: "fundamental_rights_impact_assessment",
        status: "in_progress",
        note: "Draft covers the applicant groups, the effect of a wrong score and the appeal route.",
      },
      {
        daysAgo: 89,
        obligation: "ai_literacy",
        status: "met",
        note: "All credit officers and the scoring team completed the AI literacy course.",
      },
      {
        daysAgo: 66,
        obligation: "keep_logs_six_months",
        status: "in_progress",
        note: "Retention raised to twelve months; the supplier's log export is still in testing.",
      },
      {
        daysAgo: 47,
        obligation: "inform_affected_people",
        status: "met",
        note: "Decision letters now say that an AI system supports the credit assessment.",
      },
      {
        daysAgo: 26,
        obligation: "right_to_explanation",
        status: "in_progress",
        note: "Template answer for explanation requests drafted with the supplier.",
      },
    ],
    linkRisk: {
      daysAgo: 140,
      titles: [
        "Lending decisions without four-eyes check",
        "Privacy notice out of date",
        "Stolen session tokens bypass MFA",
        "Open-source library with known flaw",
      ],
    },
  },
  {
    key: "chatbot",
    profile: {
      name: "Customer service chatbot",
      description:
        "Answers customer questions about accounts, cards and loans in the website chat and " +
        "hands over to an agent on request.",
      intendedPurpose:
        "Answer common customer questions and route the rest to customer service. The chat " +
        "opens by telling the customer they are talking to an AI assistant.",
      role: "deployer",
      supplier: "Platzhalter Dialog AG (fictional)",
      model: "Hosted chat assistant on a general-purpose model",
      usesGeneralPurposeModel: true,
      status: "in_use",
      owner: "carl",
      department: "customer-service",
    },
    answers: { ...ANSWERS, transparency: ["interacts_with_people"] },
    createdDaysAgo: 146,
    work: [
      {
        daysAgo: 133,
        obligation: "ai_literacy",
        status: "met",
        note: "Customer service team leads completed the AI literacy course.",
      },
    ],
  },
  {
    key: "fraud-detection",
    profile: {
      name: "Transaction fraud detector",
      description:
        "Scores card and transfer transactions in real time and holds suspicious ones for the " +
        "fraud team.",
      intendedPurpose:
        "Detect fraudulent payment transactions. Not a creditworthiness assessment: Annex III " +
        "point 5(b) excludes AI systems used to detect financial fraud.",
      role: "deployer",
      supplier: null,
      model: "In-house gradient-boosted model",
      usesGeneralPurposeModel: false,
      status: "in_use",
      owner: "carl",
      department: "compliance",
    },
    answers: ANSWERS,
    createdDaysAgo: 144,
    work: [
      {
        daysAgo: 110,
        obligation: "ai_literacy",
        status: "met",
        note: "Fraud analysts completed the AI literacy course.",
      },
    ],
  },
  {
    key: "cv-screening",
    profile: {
      name: "CV screening tool",
      description:
        "Ranks job applications against the job profile before recruiters read them. Under " +
        "evaluation; not yet used on real applicants.",
      intendedPurpose:
        "Shortlist applicants for advertised roles by matching CVs to the job profile.",
      role: "deployer",
      supplier: "Lorem Talent GmbH (fictional)",
      model: "Applicant ranking service",
      usesGeneralPurposeModel: true,
      status: "planned",
      owner: "carl",
      department: "hr",
    },
    answers: {
      ...ANSWERS,
      annexIIIAreas: ["employment"],
      profilesPeople: true,
      derogation: "none",
    },
    createdDaysAgo: 19,
    work: [],
  },
];
