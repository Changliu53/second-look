"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

/**
 * The submit button of a form that posts to a server action. While the
 * action runs it is disabled and dimmed, so the click is visibly taken and a
 * second click cannot send the form twice. Everything else about it is a
 * plain button, and with scripts off it still submits.
 */
export function SubmitButton({
  className = "",
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`${className} ${pending ? "cursor-progress opacity-60" : ""}`}
    >
      {children}
    </button>
  );
}
