export function SkillsCenterSection() {
  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-1">Skills Center</h3>
        <p className="text-xs text-muted-foreground">
          Browse and install skills that extend what Otterbot can do.
        </p>
      </div>

      <div className="rounded-lg border border-border p-6 bg-secondary flex flex-col items-center justify-center text-center">
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded mb-2">
          Coming Soon
        </span>
        <p className="text-xs text-muted-foreground max-w-sm">
          Discover agent skills like calendar management, browser automation, code review,
          and more. Enable or disable skills per agent.
        </p>
      </div>
    </div>
  );
}
