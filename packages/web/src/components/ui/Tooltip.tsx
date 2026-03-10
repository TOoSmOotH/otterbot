import { useState, useRef, useEffect, type ReactNode } from "react";

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const show = () => {
    timerRef.current = setTimeout(() => setVisible(true), 400);
  };
  const hide = () => {
    clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 pointer-events-none">
          <div className="whitespace-nowrap rounded-md bg-popover border border-border px-2 py-1 text-[11px] text-popover-foreground shadow-md">
            {label}
          </div>
        </div>
      )}
    </div>
  );
}
