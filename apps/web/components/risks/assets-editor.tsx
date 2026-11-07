"use client";

import { AssetTypeSchema, type AssetInput } from "@isms/contracts";
import { Button, Input, Select } from "@isms/ui";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { EditorProps } from "./inline-field";

const MAX_ASSETS = 10;

/** The affected things as rows of name and kind, for the "What is affected" field. */
export function AssetsEditor({ id, draft, setDraft }: EditorProps<AssetInput[]>) {
  const t = useTranslations("risks.record");
  const kinds = useTranslations("report.assetTypes");

  function update(index: number, next: Partial<AssetInput>) {
    setDraft(draft.map((a, i) => (i === index ? { ...a, ...next } : a)));
  }

  return (
    <div className="flex flex-col gap-3">
      {draft.map((asset, i) => {
        const number = i + 1;
        return (
          <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor={`${id}-name-${String(i)}`} className="text-[13px] font-semibold">
                {t("assetName", { number })}
              </label>
              <Input
                id={`${id}-name-${String(i)}`}
                value={asset.name}
                maxLength={120}
                onChange={(e) => {
                  update(i, { name: e.target.value });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:w-56">
              <label htmlFor={`${id}-type-${String(i)}`} className="text-[13px] font-semibold">
                {t("assetType", { number })}
              </label>
              <Select
                id={`${id}-type-${String(i)}`}
                value={asset.type}
                onChange={(e) => {
                  update(i, { type: AssetTypeSchema.parse(e.target.value) });
                }}
              >
                {AssetTypeSchema.options.map((kind) => (
                  <option key={kind} value={kind}>
                    {kinds(kind)}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="w-10 px-0"
              aria-label={t("removeAsset", { number })}
              onClick={() => {
                setDraft(draft.filter((_, j) => j !== i));
                // The row and its button go: keep focus in the editor, on "Add".
                requestAnimationFrame(() => {
                  document.getElementById(`${id}-add`)?.focus();
                });
              }}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        );
      })}
      {draft.length < MAX_ASSETS ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          id={`${id}-add`}
          className="self-start"
          onClick={() => {
            setDraft([...draft, { name: "", type: "information" }]);
          }}
        >
          <PlusIcon aria-hidden />
          {t("addAsset")}
        </Button>
      ) : null}
    </div>
  );
}
