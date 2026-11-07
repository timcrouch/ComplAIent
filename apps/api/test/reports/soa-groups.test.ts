import { describe, expect, it } from "vitest";
import {
  type GroupedRow,
  OTHER_GROUP_KEY,
  soaGroups,
  withOtherGroup,
} from "../../src/reports/soa-groups.js";
import { soaRow } from "./fixtures.js";

const gv = { key: "GV", title: "Govern", sortOrder: 0 };
const id = { key: "ID", title: "Identify", sortOrder: 3 };
const leaf = (key: string, title: string, sortOrder: number, parent: typeof gv | null) => ({
  key,
  title,
  sortOrder,
  parent,
});
const oc = leaf("GV.OC", "Organisational context", 1, gv);
const rm = leaf("GV.RM", "Risk management strategy", 2, gv);
const am = leaf("ID.AM", "Asset management", 4, id);

const row = (group: GroupedRow["group"], decided: boolean): GroupedRow => ({ group, decided });

describe("soaGroups", () => {
  it("is empty for a flat framework", () => {
    expect(soaGroups([row(null, true), row(null, false)])).toEqual([]);
  });

  it("counts decided of total per category and per function, in display order", () => {
    const groups = soaGroups([
      // Out of order on purpose: the order comes from the groups' sortOrder.
      row(am, false),
      row(oc, true),
      row(oc, false),
      row(rm, true),
      row(am, true),
      row(am, false),
    ]);
    expect(groups).toEqual([
      { key: "GV", title: "Govern", parentKey: null, decided: 2, total: 3 },
      { key: "GV.OC", title: "Organisational context", parentKey: "GV", decided: 1, total: 2 },
      { key: "GV.RM", title: "Risk management strategy", parentKey: "GV", decided: 1, total: 1 },
      { key: "ID", title: "Identify", parentKey: null, decided: 1, total: 3 },
      { key: "ID.AM", title: "Asset management", parentKey: "ID", decided: 1, total: 3 },
    ]);
  });

  it("supports one level (ISO Annex A themes)", () => {
    const a5 = leaf("A.5", "Organisational controls", 0, null);
    const a8 = leaf("A.8", "Technological controls", 3, null);
    expect(soaGroups([row(a5, true), row(a8, false), row(a8, false)])).toEqual([
      { key: "A.5", title: "Organisational controls", parentKey: null, decided: 1, total: 1 },
      { key: "A.8", title: "Technological controls", parentKey: null, decided: 0, total: 2 },
    ]);
  });

  it("leaves out groups without requirements", () => {
    expect(soaGroups([row(oc, false)]).map((g) => g.key)).toEqual(["GV", "GV.OC"]);
  });
});

describe("withOtherGroup", () => {
  const groups = soaGroups([row(oc, true)]);
  const dto = (ref: string, groupKey: string | null, decided: boolean) =>
    soaRow({ ref, groupKey, ...(decided ? {} : { decision: null }) });

  it("leaves a flat framework alone", () => {
    const rows = [dto("Art. 32", null, false)];
    expect(withOtherGroup(rows, [])).toEqual({ rows, groups: [] });
  });

  it("leaves a fully grouped framework alone", () => {
    const rows = [dto("GV.OC-01", "GV.OC", true)];
    expect(withOtherGroup(rows, groups)).toEqual({ rows, groups });
  });

  it("puts rows without a group under a trailing Other requirements group", () => {
    const result = withOtherGroup(
      [dto("GV.OC-01", "GV.OC", true), dto("OLD-01", null, true), dto("OLD-02", null, false)],
      groups,
    );
    expect(result.groups.map((g) => g.key)).toEqual(["GV", "GV.OC", OTHER_GROUP_KEY]);
    expect(result.groups.at(-1)).toEqual({
      key: OTHER_GROUP_KEY,
      title: "Other requirements",
      parentKey: null,
      decided: 1,
      total: 2,
    });
    expect(result.rows.map((r) => r.groupKey)).toEqual(["GV.OC", OTHER_GROUP_KEY, OTHER_GROUP_KEY]);
  });
});
