import { ArrowRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import { StrictMode, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  AiBadge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Chip,
  CommandPalette,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DetailItem,
  DetailList,
  Input,
  StatusBadge,
  type ThemeName,
} from "../src/index";
import "./showcase.css";

const noop = () => undefined;

const commands = [
  { id: "controls", label: "Go to controls", onSelect: noop },
  { id: "risks", label: "Go to risks", onSelect: noop },
  { id: "evidence", label: "Upload evidence", onSelect: noop },
  { id: "review", label: "Prepare ISO 27001 review", onSelect: noop },
  { id: "invite", label: "Invite a colleague", onSelect: noop },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] font-bold tracking-[0.08em] text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}

const metrics = [
  { name: "Controls", value: "211 / 214", unit: "working", pct: 98 },
  { name: "Evidence", value: "86%", unit: "current", pct: 86 },
  { name: "Risks", value: "5", unit: "above appetite", pct: 13 },
  { name: "Tasks", value: "7", unit: "overdue", pct: 22 },
];

function Metric({ m }: { m: (typeof metrics)[number] }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="text-xs font-medium text-fg-muted">{m.name}</div>
        <div className="mt-1 text-[15px] font-bold tabular-nums">
          {m.value} <span className="font-medium text-fg-muted">{m.unit}</span>
        </div>
        <div
          className="mt-3 h-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--isms-text)_9%,transparent)]"
          role="presentation"
        >
          <div
            className="h-full rounded-full bg-linear-90 from-[color-mix(in_oklab,var(--isms-accent),white_22%)] to-accent"
            style={{ width: `${String(m.pct)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

const briefing = [
  {
    status: "ok",
    label: "Working",
    text: "Your controls are working normally, with 3 exceptions.",
    action: "Review",
  },
  {
    status: "attention",
    label: "Needs approval",
    text: "2 decisions need your approval.",
    action: "Open",
  },
  {
    status: "info",
    label: "Scheduled",
    text: "ISO 27001 review in 12 days. 4 evidence items missing.",
    action: "Prepare",
  },
] as const;

function Briefing() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-bold tracking-[-0.02em]">
          Good morning, Anna. Here’s your security picture.
        </CardTitle>
        <CardDescription>Based on 214 controls and 38 risks · updated 4 min ago</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {briefing.map((b) => (
          <div
            key={b.text}
            className="flex items-center gap-3 rounded-md border border-surface-border bg-surface px-3 py-2.5 shadow-glass"
          >
            <StatusBadge status={b.status} label={b.label} />
            <span className="min-w-0 flex-1 truncate">{b.text}</span>
            <Button variant="ghost" size="sm" className="text-accent">
              {b.action}
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          </div>
        ))}
      </CardContent>
      <CardFooter className="justify-between">
        <AiBadge state="suggested" />
        <span className="text-xs text-fg-muted">Each line opens the records behind it</span>
      </CardFooter>
    </Card>
  );
}

/** A clipped stage: `transform` makes it the containing block for the fixed overlay. */
function Stage({ children }: { children: (el: HTMLElement) => ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <div
      ref={setEl}
      className="relative h-[400px] overflow-hidden rounded-lg border border-surface-border bg-linear-160 from-bg-gradient-from to-bg-gradient-to [transform:translateZ(0)]"
    >
      <div className="grid grid-cols-2 gap-3 p-5 opacity-80" aria-hidden="true">
        {metrics.map((m) => (
          <Metric key={m.name} m={m} />
        ))}
      </div>
      {el && children(el)}
    </div>
  );
}

function Panel({ theme }: { theme: ThemeName }) {
  const [selected, setSelected] = useState(["ISO 27001", "Open"]);
  const toggle = (chip: string) => {
    setSelected((s) => (s.includes(chip) ? s.filter((c) => c !== chip) : [...s, chip]));
  };
  return (
    <div
      data-theme={theme}
      data-panel={theme}
      className="min-h-screen bg-linear-160 from-bg-gradient-from via-[color-mix(in_oklab,var(--isms-bg),var(--isms-text)_3%)] to-bg-gradient-to px-12 py-10 font-sans text-sm text-fg"
    >
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full bg-accent shadow-[0_0_0_4px_var(--isms-accent-soft)]" />
          <span className="text-[13px] font-bold">Security workspace</span>
          <span className="text-[13px] text-fg-muted">
            · {theme === "light" ? "Light" : "Dark"}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-64 justify-start font-medium text-fg-muted"
        >
          <SearchIcon aria-hidden="true" />
          Search or ask anything
          <kbd className="ml-auto rounded-[5px] border border-surface-border px-1.5 text-[11px] font-semibold">
            ⌘K
          </kbd>
        </Button>
      </header>

      <div className="flex flex-col gap-8">
        <Briefing />
        <div className="grid grid-cols-4 gap-3">
          {metrics.map((m) => (
            <Metric key={m.name} m={m} />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-8">
          <Section title="Buttons">
            <Row>
              <Button>
                <PlusIcon aria-hidden="true" />
                New control
              </Button>
              <Button variant="secondary">Export</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="destructive">Delete everything</Button>
            </Row>
            <Row>
              <Button size="sm">Approve</Button>
              <Button size="sm" variant="secondary">
                Assign
              </Button>
              <Button size="sm" disabled>
                Disabled
              </Button>
            </Row>
          </Section>
          <Section title="Input">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`owner-${theme}`} className="text-[13px] font-semibold">
                Control owner
              </label>
              <Input id={`owner-${theme}`} placeholder="Search people by name" />
              <span className="text-xs text-fg-muted">
                The owner is notified when evidence is due.
              </span>
            </div>
          </Section>
          <Section title="Status">
            <Row>
              <StatusBadge status="ok" label="Working" />
              <StatusBadge status="attention" label="Needs attention" />
              <StatusBadge status="critical" label="Failing" />
              <StatusBadge status="info" label="Scheduled" />
              <StatusBadge status="unknown" label="Not assessed" />
            </Row>
          </Section>
          <Section title="AI markers">
            <Row>
              <AiBadge state="suggested" />
              <AiBadge state="draft" />
            </Row>
            <p className="text-xs text-fg-muted">
              Shown on every AI suggestion until a person confirms it.
            </p>
          </Section>
          <div className="col-span-2">
            <Section title="Details">
              <Card>
                <CardContent>
                  <DetailList>
                    <DetailItem
                      label="Title"
                      action={
                        <Button variant="ghost" size="sm">
                          Edit
                        </Button>
                      }
                    >
                      Supplier contract lacks security terms
                    </DetailItem>
                    <DetailItem label="What could happen" emphasis="long">
                      A supplier with access to customer data could lose it, and the contract gives
                      us no right to audit or to be told quickly.
                    </DetailItem>
                    <DetailItem label="Assessment">
                      <DetailList density="compact">
                        <DetailItem label="Likelihood">3 · Possible</DetailItem>
                        <DetailItem label="Impact">4 · Major</DetailItem>
                      </DetailList>
                    </DetailItem>
                    <DetailItem label="Site">Munich</DetailItem>
                    <DetailItem label="Owner" empty="No owner" />
                  </DetailList>
                </CardContent>
              </Card>
            </Section>
          </div>
          <div className="col-span-2">
            <Section title="Filter chips">
              <Row>
                {["ISO 27001", "NIS2", "DORA", "Open", "Overdue", "Owned by me"].map((c) => (
                  <Chip
                    key={c}
                    selected={selected.includes(c)}
                    onSelectedChange={() => {
                      toggle(c);
                    }}
                  >
                    {c}
                  </Chip>
                ))}
              </Row>
            </Section>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Section title="Dialog">
            <Stage>
              {(container) => (
                <Dialog defaultOpen modal={false}>
                  <DialogContent container={container} className="sm:max-w-[400px]">
                    <DialogHeader>
                      <DialogTitle>Accept this risk?</DialogTitle>
                      <DialogDescription>
                        “Supplier access reviews” stays above appetite until 31 March. You can
                        change this decision at any time.
                      </DialogDescription>
                    </DialogHeader>
                    <AiBadge state="draft" />
                    <DialogFooter>
                      <DialogClose render={<Button variant="secondary" />}>Not now</DialogClose>
                      <Button>Accept risk</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </Stage>
          </Section>
          <Section title="Command palette">
            <Stage>
              {(container) => (
                <CommandPalette
                  defaultOpen
                  modal={false}
                  container={container}
                  items={commands}
                  className="top-6"
                />
              )}
            </Stage>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Showcase() {
  return (
    <main className="grid min-w-[1920px] grid-cols-2">
      <h1 className="sr-only">@isms/ui Clear Glass showcase</h1>
      <Panel theme="light" />
      <Panel theme="dark" />
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Showcase />
    </StrictMode>,
  );
}
