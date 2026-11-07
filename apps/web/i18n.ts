import { getRequestConfig } from "next-intl/server";
import messages from "./messages/index";

/**
 * next-intl request configuration: English only, no locale routing (URLs carry no locale).
 * Dates are formatted in UTC unless a component passes the user's time zone explicitly.
 */
export default getRequestConfig(() => ({ locale: "en", messages, timeZone: "UTC" }));
