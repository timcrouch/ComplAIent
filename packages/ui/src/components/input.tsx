import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "../lib/cn";
import { controlClass } from "./control";

type InputProps = InputPrimitive.Props;

function Input({ className, ...props }: InputProps) {
  return (
    <InputPrimitive data-slot="input" className={cn("h-10", controlClass, className)} {...props} />
  );
}

export { Input };
export type { InputProps };
