import type { BoardChangeDto, BoardFactsDto, BoardPeriodDto, BoardTileDto } from "@isms/contracts";
import { BOARD_TILES, type BoardTileKey, changeLine } from "@isms/domain";

type PeriodKey = "reported" | "approved" | "closed";

/**
 * The seven status tiles in `BOARD_TILES` order (spec §4.1, §4.2), each with the fact's value:
 * - reported, approved and closed (Treated) change against the previous period's facts;
 * - open risks and above appetite change since the period start (version history, today's
 *   appetite); only above appetite is judged (more is worse);
 * - overdue actions and reviews due have no change: their past cannot be rebuilt exactly.
 */
export function boardTiles(
  facts: BoardFactsDto,
  previous: { period: BoardPeriodDto; counts: Pick<BoardFactsDto, PeriodKey> },
  start: { since: string; open: number; aboveAppetite: number },
): BoardTileDto[] {
  const change = (key: BoardTileKey): BoardChangeDto | null => {
    switch (key) {
      case "reported":
      case "approved":
      case "closed":
        return {
          ...changeLine(facts[key], previous.counts[key], false),
          basis: { kind: "previousPeriod", period: previous.period },
        };
      case "openRisks":
        return {
          ...changeLine(facts.openRisks, start.open, false),
          basis: { kind: "since", date: start.since },
        };
      case "aboveAppetite":
        return {
          ...changeLine(facts.aboveAppetite, start.aboveAppetite, true),
          basis: { kind: "since", date: start.since },
        };
      case "overdueActions":
      case "reviewsDue":
        return null;
    }
  };
  return BOARD_TILES.map(({ key }) => ({ key, value: facts[key], change: change(key) }));
}
