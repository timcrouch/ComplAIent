"use client";

import { Input, Select, Textarea } from "@isms/ui";
import type { EditorProps } from "./inline-field";

/** A one-line text editor for InlineField. */
export function textEditor(maxLength: number) {
  function TextEditor({ id, draft, setDraft, a11y }: EditorProps<string>) {
    return (
      <Input
        id={id}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        {...a11y}
      />
    );
  }
  return TextEditor;
}

/** A multi-line text editor for InlineField. */
export function areaEditor(maxLength: number) {
  function AreaEditor({ id, draft, setDraft, a11y }: EditorProps<string>) {
    return (
      <Textarea
        id={id}
        rows={4}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        {...a11y}
      />
    );
  }
  return AreaEditor;
}

export type Option = { value: string; label: string };

/** A native select over `options`; "" stands for no value (null). */
export function selectEditor(options: readonly Option[]) {
  function SelectEditor({ id, draft, setDraft, a11y }: EditorProps<string | null>) {
    return (
      <Select
        id={id}
        value={draft ?? ""}
        onChange={(e) => {
          setDraft(e.target.value === "" ? null : e.target.value);
        }}
        {...a11y}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  return SelectEditor;
}
