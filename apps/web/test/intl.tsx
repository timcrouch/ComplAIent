import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach } from "vitest";
import en from "../messages/index";

afterEach(() => {
  cleanup();
});

export const MARK = "·";

/** Every message with a marker appended: proves a visible string came from the message file. */
export function marked(value: unknown): unknown {
  if (typeof value === "string") return `${value}${MARK}`;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, marked(v)]));
  }
  return value;
}

export function withMessages(ui: ReactNode, messages: unknown = en) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages as typeof en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

/** A promise the test settles by hand, to observe a pending state. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Clicks a link, running its handlers but not the browser navigation jsdom can't do. */
export function clickLink(link: HTMLElement): void {
  const stop = (e: Event) => {
    e.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true });
  fireEvent.click(link);
  window.removeEventListener("click", stop, { capture: true });
}
