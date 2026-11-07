"use client";

import { useState } from "react";
import type { FieldErrors, ReportValues } from "./report-fields";

type TextKey = "title" | "scenario" | "threat" | "consequence" | "existingSafeguards";

/**
 * The values being edited (summary card or step form) and their field errors, with a setter per
 * field and the props of a text answer (`TextField`), so both editors share one shape.
 */
export function useReportValues<V extends Pick<ReportValues, TextKey>>(
  idPrefix: string,
  initial: () => V,
) {
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set =
    <K extends keyof V>(key: K) =>
    (value: V[K]) => {
      setValues((v) => ({ ...v, [key]: value }));
    };

  const text = (key: TextKey) => ({
    id: `${idPrefix}-${key}`,
    error: errors[key],
    value: values[key],
    onChange: (value: string) => {
      setValues((v) => ({ ...v, [key]: value }));
    },
  });

  return { values, set, errors, setErrors, text };
}
