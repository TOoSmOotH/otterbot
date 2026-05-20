import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const base =
  "w-full bg-surface text-fg border border-border rounded-md px-2.5 py-1.5 text-body placeholder:text-subtle focus-visible:border-border-strong";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${base} ${className ?? ""}`} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={`${base} resize-y leading-relaxed font-sans ${className ?? ""}`}
    />
  );
}
