import { useState, type InputHTMLAttributes } from "react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Controls the input type externally. When undefined, uses internal toggle state. */
  visible?: boolean;
  /** Called when the visibility toggle is clicked. */
  onVisibilityChange?: (visible: boolean) => void;
}

export function PasswordInput({
  visible: controlledVisible,
  onVisibilityChange,
  className = "",
  ...props
}: PasswordInputProps) {
  const [internalVisible, setInternalVisible] = useState(false);
  const isVisible = controlledVisible ?? internalVisible;

  const toggle = () => {
    const next = !isVisible;
    setInternalVisible(next);
    onVisibilityChange?.(next);
  };

  return (
    <div className="relative">
      <input
        type={isVisible ? "text" : "password"}
        className={`w-full px-3 py-2 pr-10 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow ${className}`}
        {...props}
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={isVisible ? "Hide passphrase" : "Show passphrase"}
        tabIndex={-1}
      >
        {isVisible ? (
          /* Eye-off icon */
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          </svg>
        ) : (
          /* Eye icon */
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
