/**
 * @isms/ui — Clear Glass design system.
 *
 * Text: every user-visible string in these components can be overridden
 * (StatusBadge `label`, AiBadge `label`, DialogContent `closeLabel`,
 * CommandPalette `labels`). The English defaults are for development only:
 * apps must pass every label from their message files (apps/web/messages).
 *
 * Styles: import "tailwindcss" then "@isms/ui/tokens.css" in the app stylesheet.
 * Font: set the CSS variable --isms-font-sans (e.g. the next/font variable for
 * Plus Jakarta Sans, including a fallback stack); `font-sans` resolves it at runtime.
 */
export { tokens } from "./tokens/tokens";
export type { ThemeName, ThemeTokens, Tokens } from "./tokens/tokens";
export {
  ABOVE_APPETITE_CELL,
  ABOVE_APPETITE_EDGE,
  ABOVE_APPETITE_TEXT,
  AboveAppetiteIcon,
} from "./above-appetite";
export { cn } from "./lib/cn";

export { AiBadge } from "./components/ai-badge";
export type { AiBadgeProps, AiState } from "./components/ai-badge";
export { Button, buttonVariants } from "./components/button";
export type { ButtonProps } from "./components/button";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/card";
export { Chip } from "./components/chip";
export type { ChipProps } from "./components/chip";
export { CommandPalette } from "./components/command-palette";
export type {
  CommandItem,
  CommandPaletteLabels,
  CommandPaletteProps,
} from "./components/command-palette";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/dialog";
export type { DialogContentProps } from "./components/dialog";
export { DetailItem, DetailList } from "./components/detail-list";
export type { DetailItemProps, DetailListProps } from "./components/detail-list";
export { Field, fieldA11y } from "./components/field";
export type { FieldProps } from "./components/field";
export { Input } from "./components/input";
export type { InputProps } from "./components/input";
export { StatusBadge } from "./components/status-badge";
export type { Status, StatusBadgeProps } from "./components/status-badge";
export { Select } from "./components/select";
export type { SelectProps } from "./components/select";
export { Textarea } from "./components/textarea";
export type { TextareaProps } from "./components/textarea";
