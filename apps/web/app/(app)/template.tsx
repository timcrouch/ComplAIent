import type { ReactNode } from "react";
import { PageTransition } from "../../components/motion/entrance";

/** Re-mounted on every navigation inside the app, so each page fades in (not when reduced). */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
