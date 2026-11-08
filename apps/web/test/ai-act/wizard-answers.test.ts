import { AiClassificationAnswers } from "@isms/contracts";
import { ANNEX_III_AREAS } from "@isms/domain";
import { describe, expect, it } from "vitest";
import {
  EMPTY_ANSWERS,
  finalAnswers,
  nextStep,
  previousStep,
  toggled,
  unansweredOn,
  type DraftAnswers,
} from "../../components/ai-act/wizard-answers";

const answered: DraftAnswers = { ...EMPTY_ANSWERS, isAiSystem: true, annexISafetyComponent: false };

describe("wizard answers", () => {
  it("keeps chosen values in catalogue order without repeats", () => {
    expect(toggled(ANNEX_III_AREAS, ["employment"], "biometrics", true)).toEqual([
      "biometrics",
      "employment",
    ]);
    expect(toggled(ANNEX_III_AREAS, ["employment"], "employment", true)).toEqual(["employment"]);
    expect(toggled(ANNEX_III_AREAS, ["employment"], "employment", false)).toEqual([]);
  });

  it("asks for the yes/no answers, and for profiling and derogation only with an area", () => {
    expect(unansweredOn("aiSystem", EMPTY_ANSWERS)).toBe(true);
    expect(unansweredOn("annexI", EMPTY_ANSWERS)).toBe(true);
    expect(unansweredOn("annexIII", answered)).toBe(false);
    const area = { ...answered, annexIIIAreas: ["creditworthiness" as const] };
    expect(unansweredOn("annexIII", area)).toBe(true);
    expect(unansweredOn("annexIII", { ...area, profilesPeople: false, derogation: "none" })).toBe(
      false,
    );
    expect(unansweredOn("prohibited", EMPTY_ANSWERS)).toBe(false);
  });

  it("skips to the review when it is not an AI system, and back again", () => {
    const notAi = { ...EMPTY_ANSWERS, isAiSystem: false };
    expect(nextStep("aiSystem", notAi)).toBe("review");
    expect(previousStep("review", notAi)).toBe("aiSystem");
    expect(nextStep("aiSystem", answered)).toBe("prohibited");
    expect(previousStep("review", answered)).toBe("transparency");
  });

  it("produces answers the contract accepts: follow-ups null without an area, set with one", () => {
    const none = finalAnswers({ ...answered, profilesPeople: true, derogation: "none" });
    expect(none).toMatchObject({ annexIIIAreas: [], profilesPeople: null, derogation: null });
    expect(AiClassificationAnswers.safeParse(none).success).toBe(true);

    const credit = finalAnswers({
      ...answered,
      annexIIIAreas: ["creditworthiness"],
      profilesPeople: true,
      derogation: "none",
    });
    expect(credit).toMatchObject({ profilesPeople: true, derogation: "none" });
    expect(AiClassificationAnswers.safeParse(credit).success).toBe(true);

    const notAi = finalAnswers({ ...answered, isAiSystem: false, annexIIIAreas: ["employment"] });
    expect(AiClassificationAnswers.safeParse(notAi).success).toBe(true);
    expect(notAi?.annexIIIAreas).toEqual([]);
  });

  it("is null while an asked question is unanswered", () => {
    expect(finalAnswers(EMPTY_ANSWERS)).toBeNull();
    expect(finalAnswers({ ...EMPTY_ANSWERS, isAiSystem: true })).toBeNull();
    expect(finalAnswers({ ...answered, annexIIIAreas: ["employment"] })).toBeNull();
  });
});
