import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "border border-transparent bg-primary text-primary-fg hover:brightness-110",
  outline: "border border-border bg-bg hover:bg-hover",
  danger: "border border-border bg-bg text-danger hover:bg-danger-soft",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5",
  md: "h-[34px] px-4",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "outline", size = "md", className = "", ...props }: Props) {
  return (
    <button
      type="button"
      className={`inline-flex flex-none items-center justify-center gap-1.5 rounded-md font-medium disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
