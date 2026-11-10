import aiAct from "./en/ai-act.json" with { type: "json" };
import aiActRules from "./en/ai-act-rules.json" with { type: "json" };
import common from "./en/common.json" with { type: "json" };
import evidence from "./en/evidence.json" with { type: "json" };
import home from "./en/home.json" with { type: "json" };
import insights from "./en/insights.json" with { type: "json" };
import library from "./en/library.json" with { type: "json" };
import report from "./en/report.json" with { type: "json" };
import reports from "./en/reports.json" with { type: "json" };
import risks from "./en/risks.json" with { type: "json" };
import settings from "./en/settings.json" with { type: "json" };
import rewards from "./en/rewards.json" with { type: "json" };
import setup from "./en/setup.json" with { type: "json" };
import shell from "./en/shell.json" with { type: "json" };

/** All English messages, merged from the per-area files. Top-level keys must not collide. */
const messages = {
  ...common,
  ...shell,
  ...home,
  ...setup,
  ...library,
  ...settings,
  ...rewards,
  ...report,
  ...risks,
  ...evidence,
  ...insights,
  ...reports,
  ...aiAct,
  ...aiActRules,
};

export default messages;
