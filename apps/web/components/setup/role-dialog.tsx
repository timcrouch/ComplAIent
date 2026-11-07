"use client";

import {
  RoleSchema,
  type DepartmentDto,
  type Role,
  type ScopeInput,
  type SiteDto,
  type UserSummaryDto,
} from "@isms/contracts";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  fieldA11y,
  Select,
} from "@isms/ui";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { grantRole, revokeRole } from "../../lib/actions/roles";
import { goTo } from "../../lib/navigate";
import type { CallResult } from "../../lib/server-api";
import { roleFailureMessage } from "./role-errors";
import type { SetupErrorKey } from "./save-flow";
import { choiceInput } from "./styles";

type ScopeType = ScopeInput["type"];
const ROLES = RoleSchema.options;

type RoleDialogProps = {
  user: UserSummaryDto;
  sites: readonly SiteDto[];
  departments: readonly DepartmentDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const scopeOf = (type: ScopeType, unitId: string): ScopeInput | null =>
  type === "organisation" ? { type, id: null } : unitId ? { type, id: unitId } : null;

/** The user's assignments at exactly this scope. */
const heldAt = (user: UserSummaryDto, type: ScopeType, unitId: string) =>
  user.roles.filter(
    (a) => a.scope.type === type && (type === "organisation" || a.scope.id === unitId),
  );

/**
 * Which roles a person has at one scope (the whole organisation, one site or one
 * department). Saving sends only the difference, one change at a time, and stops at the
 * first refusal, whose message comes from en.json.
 */
export function RoleDialog({
  user,
  sites,
  departments,
  open,
  onOpenChange,
  onSaved,
}: RoleDialogProps) {
  const t = useTranslations("setup.people.dialog");
  const tr = useTranslations("roles");
  const ts = useTranslations("setup");
  const id = useId();
  const unitRef = useRef<HTMLSelectElement>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("organisation");
  const [unitId, setUnitId] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<Role>>(
    () => new Set(heldAt(user, "organisation", "").map((a) => a.role)),
  );
  const [scopeError, setScopeError] = useState(false);
  const [error, setError] = useState<SetupErrorKey | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The ticks show the roles held at the chosen scope. Ticks made before a site or department
   * was picked are kept when it is picked, so the choice order does not matter.
   */
  function moveTo(type: ScopeType, unit: string) {
    const held = heldAt(user, type, unit).map((a) => a.role);
    const pending = scopeOf(scopeType, unitId) === null;
    setScopeType(type);
    setUnitId(unit);
    setChecked((current) => new Set(pending ? [...current, ...held] : held));
    setScopeError(false);
    setError(null);
  }

  function toggle(role: Role, on: boolean) {
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(role);
      else next.delete(role);
      return next;
    });
  }

  /** False when the change was refused (or the browser is leaving to sign in again). */
  function accepted(result: CallResult<unknown>): boolean {
    if (result.ok) return true;
    if ((result.kind === "signed-out" || result.kind === "reauth") && result.href) {
      goTo(result.href);
    } else setError(roleFailureMessage(result));
    return false;
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const scope = scopeOf(scopeType, unitId);
    if (!scope) {
      setScopeError(true);
      unitRef.current?.focus();
      return;
    }
    const held = heldAt(user, scopeType, unitId);
    const grants = ROLES.filter((role) => checked.has(role) && !held.some((a) => a.role === role));
    const revokes = held.filter((a) => !checked.has(a.role));
    setBusy(true);
    setError(null);
    try {
      // Grants first, so moving the administrator role to someone else never leaves none.
      for (const role of grants) if (!accepted(await grantRole(user.id, { role, scope }))) return;
      for (const a of revokes) if (!accepted(await revokeRole(a.id))) return;
      onSaved();
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  }

  const units = scopeType === "site" ? sites : departments;
  const unitFieldId = `${id}-unit`;
  const unitError = scopeError ? ts("errors.scope") : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={ts("people.dialog.cancel")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("title", { name: user.displayName })}</DialogTitle>
          <DialogDescription>{t("description", { name: user.displayName })}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-scope`} label={t("scopeType")}>
              <Select
                id={`${id}-scope`}
                value={scopeType}
                onChange={(e) => {
                  moveTo(e.target.value as ScopeType, "");
                }}
              >
                <option value="organisation">{t("scopeTypes.organisation")}</option>
                <option value="site" disabled={sites.length === 0}>
                  {t("scopeTypes.site")}
                </option>
                <option value="department" disabled={departments.length === 0}>
                  {t("scopeTypes.department")}
                </option>
              </Select>
            </Field>
            {scopeType === "organisation" ? null : (
              <Field
                id={unitFieldId}
                label={scopeType === "site" ? t("site") : t("department")}
                error={unitError}
              >
                <Select
                  id={unitFieldId}
                  ref={unitRef}
                  value={unitId}
                  onChange={(e) => {
                    moveTo(scopeType, e.target.value);
                  }}
                  {...fieldA11y(unitFieldId, { hint: false, error: unitError })}
                >
                  <option value="" disabled>
                    {scopeType === "site" ? t("chooseSite") : t("chooseDepartment")}
                  </option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold text-fg">{t("rolesLegend")}</legend>
            {ROLES.map((role) => {
              const inputId = `${id}-${role}`;
              return (
                <label
                  key={role}
                  htmlFor={inputId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-sm px-2 py-2",
                    "hover:bg-[color-mix(in_oklab,transparent,var(--isms-text)_5%)]",
                    "has-focus-visible:ring-2 has-focus-visible:ring-focus-ring",
                  )}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked.has(role)}
                    onChange={(e) => {
                      toggle(role, e.target.checked);
                    }}
                    aria-labelledby={`${inputId}-label`}
                    aria-describedby={`${inputId}-description`}
                    className={cn(choiceInput, "rounded-[5px]")}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span id={`${inputId}-label`} className="text-sm font-semibold text-fg">
                      {tr(`${role}.label`)}
                    </span>
                    <span
                      id={`${inputId}-description`}
                      className="text-[13px] leading-relaxed text-fg-muted"
                    >
                      {tr(`${role}.description`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
            >
              <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
              <span>{ts(`errors.${error}`)}</span>
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("cancel")}
            </DialogClose>
            <Button type="submit" disabled={busy} focusableWhenDisabled>
              {busy ? ts("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
