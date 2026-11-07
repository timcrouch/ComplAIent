// @vitest-environment jsdom
import type { ApprovalReadinessDto, RiskDetailDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, RIGA, SCALE, conflict, ok, riskDetail } from "../risks/fixtures";

const submitRisk = vi.fn();
const approveRisk = vi.fn();
const returnRisk = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  submitRisk: (...a: unknown[]) => submitRisk(...a) as unknown,
  approveRisk: (...a: unknown[]) => approveRisk(...a) as unknown,
  returnRisk: (...a: unknown[]) => returnRisk(...a) as unknown,
  getRisk: vi.fn(),
  updateRisk: vi.fn(),
  requestControlSuggestions: vi.fn(),
  decideControl: vi.fn(),
  addControl: vi.fn(),
  removeControl: vi.fn(),
  searchControls: vi.fn(),
  requestEvidence: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.approval;
const ADAM = { id: "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c", displayName: "Adam Approver" };

const approval = (overrides: Partial<ApprovalReadinessDto> = {}): ApprovalReadinessDto => ({
  rule: "independentApprover",
  reviewer: CARL,
  eligibleApproverCount: 1,
  noEligibleApprover: false,
  viewerRefusal: null,
  decisions: [],
  ...overrides,
});

const can = (overrides: Partial<RiskDetailDto["can"]> = {}): RiskDetailDto["can"] => ({
  ...riskDetail().can,
  edit: false,
  submit: false,
  ...overrides,
});

const inReview = (a: Partial<ApprovalReadinessDto>, c: Partial<RiskDetailDto["can"]> = {}) =>
  riskDetail({ state: "in_review", version: 7, approval: approval(a), can: can(c) });

function detail(risk: RiskDetailDto) {
  return withMessages(
    <RiskDetail
      initial={risk}
      scale={SCALE}
      sites={[RIGA]}
      departments={[]}
      owners={null}
      evidenceMaxBytes={1000}
      canSearchLibrary={false}
      timeZone="UTC"
    />,
  );
}

const section = () => screen.getByRole("region", { name: t.title });
const announcer = () => screen.getByTestId("risk-announcer");

beforeEach(() => {
  submitRisk.mockReset();
  approveRisk.mockReset();
  returnRisk.mockReset();
});

describe("approval section", () => {
  it("explains each approval refusal in plain words", () => {
    const sentences = {
      reporter: "You reported this risk, so someone else must approve it.",
      reviewerNeedsIndependent:
        "This risk is above your appetite or accepted, so someone other than its reviewer must approve it.",
      notApprover: "You don't hold the approver role for this risk.",
    } as const;
    for (const [reason, sentence] of Object.entries(sentences)) {
      expect(t.refusal[reason as keyof typeof sentences]).toBe(sentence);
      const view = detail(inReview({ viewerRefusal: reason as keyof typeof sentences }));
      expect(within(section()).getByText(sentence)).toBeTruthy();
      expect(within(section()).queryByRole("button", { name: t.approve })).toBeNull();
      view.unmount();
    }
  });

  it("explains a refusal the API gives when approving", async () => {
    approveRisk.mockResolvedValue(conflict("approvalRefused.reporter"));
    detail(inReview({}, { approve: true }));
    await userEvent.click(within(section()).getByRole("button", { name: t.approve }));
    expect(await within(section()).findByText(t.refusal.reporter)).toBeTruthy();
    expect(approveRisk).toHaveBeenCalledWith(riskDetail().id, 7, "");
  });

  it("says when no one else can approve the risk", () => {
    detail(inReview({ noEligibleApprover: true, eligibleApproverCount: 0 }));
    expect(
      within(section()).getByText(
        "No one else can approve this yet — an administrator can give the approver role to someone",
      ),
    ).toBeTruthy();
  });

  it("submits for approval and lists each blocker in plain words", async () => {
    submitRisk.mockResolvedValueOnce({
      ok: false,
      kind: "conflict",
      details: [
        { path: "submitBlocked.missingLikelihood", message: "x" },
        { path: "submitBlocked.missingOwner", message: "x" },
        { path: "submitBlocked.unresolvedToConfirm", message: "x" },
      ],
    });
    detail(riskDetail({ can: can({ edit: true, submit: true }) }));
    const submit = within(section()).getByRole("button", { name: t.submit });
    await userEvent.click(submit);
    const list = await within(section()).findByRole("list", { name: t.blockersTitle });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      t.blockers.missingLikelihood,
      t.blockers.missingOwner,
      t.blockers.unresolvedToConfirm,
    ]);
    expect(submitRisk).toHaveBeenCalledWith(riskDetail().id, 2);

    submitRisk.mockResolvedValueOnce(ok(inReview({})));
    await userEvent.click(submit);
    await waitFor(() => {
      expect(announcer().textContent).toBe(t.submitted);
    });
    expect(within(section()).queryByRole("list", { name: t.blockersTitle })).toBeNull();
    // The button went away with the state: focus is on the section heading, not the body.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: t.title }));
  });

  it("approves with an optional comment", async () => {
    approveRisk.mockResolvedValue(
      ok(
        riskDetail({
          state: "approved",
          version: 8,
          approval: approval({
            decisions: [
              {
                decision: "approved",
                approver: ADAM,
                comment: "Fine",
                version: 7,
                at: "2026-11-05T12:00:00.000Z",
              },
            ],
          }),
          can: can(),
        }),
      ),
    );
    detail(inReview({}, { approve: true, return: true }));
    await userEvent.type(within(section()).getByLabelText(t.comment), "Fine");
    await userEvent.click(within(section()).getByRole("button", { name: t.approve }));
    await waitFor(() => {
      expect(announcer().textContent).toBe(t.approved);
    });
    expect(approveRisk).toHaveBeenCalledWith(riskDetail().id, 7, "Fine");
    const decisions = within(section()).getByRole("list", { name: t.decisionsLabel });
    expect(decisions.textContent).toContain("Approved by Adam Approver");
    expect(decisions.textContent).toContain("Fine");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: t.title }));
  });

  it("returning needs a comment, linked to the field", async () => {
    returnRisk.mockResolvedValue(
      ok(riskDetail({ state: "returned", version: 8, can: can({ edit: true, submit: true }) })),
    );
    detail(inReview({}, { return: true }));
    const field = within(section()).getByLabelText(t.comment);
    await userEvent.click(within(section()).getByRole("button", { name: t.return }));
    expect(returnRisk).not.toHaveBeenCalled();
    expect(within(section()).getByText(t.commentRequired)).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain(
      within(section()).getByText(t.commentRequired).closest("p")?.id,
    );
    expect(document.activeElement).toBe(field);

    await userEvent.type(field, "Owner is wrong");
    await userEvent.click(within(section()).getByRole("button", { name: t.return }));
    await waitFor(() => {
      expect(announcer().textContent).toBe(t.returned);
    });
    expect(returnRisk).toHaveBeenCalledWith(riskDetail().id, 7, "Owner is wrong");
  });

  it("shows the reload notice when someone else changed the risk", async () => {
    approveRisk.mockResolvedValue(conflict("staleVersion"));
    detail(inReview({}, { approve: true }));
    await userEvent.click(within(section()).getByRole("button", { name: t.approve }));
    expect(await within(section()).findByText(en.risks.stale.message)).toBeTruthy();
  });

  it("names a decision on another version in the history", () => {
    detail(
      riskDetail({
        state: "returned",
        approval: approval({
          decisions: [
            {
              decision: "returned",
              approver: ADAM,
              comment: "Owner is wrong",
              version: 5,
              at: "2026-11-05T12:00:00.000Z",
            },
          ],
        }),
      }),
    );
    const decisions = within(section()).getByRole("list", { name: t.decisionsLabel });
    expect(decisions.textContent).toContain("Returned by Adam Approver");
    expect(decisions.textContent).toContain("Owner is wrong");
    expect(decisions.textContent).toContain("Version 5");
  });
});
