"use client";

import { Button, Field, fieldA11y, Textarea } from "@isms/ui";
import { SendHorizontalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type KeyboardEvent, type SubmitEvent } from "react";

type ChatComposerProps = {
  /** A turn is running: the text waits, the button is disabled. */
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
};

/** The reporter's answer box. Enter sends; Shift+Enter starts a new line. */
export function ChatComposer({ busy, onSend }: ChatComposerProps) {
  const t = useTranslations("report");
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [empty, setEmpty] = useState(false);

  async function send() {
    if (busy) return;
    const value = text.trim();
    if (value.length === 0) {
      setEmpty(true);
      ref.current?.focus();
      return;
    }
    setEmpty(false);
    // The text is cleared once the API has it; a refused send leaves it to try again.
    if (await onSend(value)) setText("");
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  const error = empty ? t("errors.textRequired") : undefined;
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field id={id} label={t("chat.composerLabel")} hint={t("chat.composerHint")} error={error}>
        <Textarea
          ref={ref}
          id={id}
          data-composer
          rows={3}
          maxLength={4000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={onKeyDown}
          {...fieldA11y(id, { hint: true, error })}
        />
      </Field>
      <Button type="submit" className="self-end" disabled={busy}>
        <SendHorizontalIcon aria-hidden />
        {t("chat.send")}
      </Button>
    </form>
  );
}
