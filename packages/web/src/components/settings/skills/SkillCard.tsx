import { useState, useRef, useEffect } from "react";
import type { Skill } from "@otterbot/shared";

const SCAN_STATUS_STYLES: Record<string, string> = {
  clean: "bg-green-500/15 text-green-400",
  warnings: "bg-yellow-500/15 text-yellow-400",
  errors: "bg-red-500/15 text-red-400",
  unscanned: "bg-muted text-muted-foreground",
};

const SCAN_STATUS_LABELS: Record<string, string> = {
  clean: "Clean",
  warnings: "Warnings",
  errors: "Errors",
  unscanned: "Not Scanned",
};

interface SkillCardProps {
  skill: Skill;
  onEdit: (skill: Skill) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  onViewScan: (skill: Skill) => void;
}

export function SkillCard({ skill, onEdit, onExport, onDelete, onViewScan }: SkillCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium truncate">{skill.meta.name}</h4>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${SCAN_STATUS_STYLES[skill.scanStatus]}`}
            >
              {SCAN_STATUS_LABELS[skill.scanStatus]}
            </span>
          </div>
          {skill.meta.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {skill.meta.description}
            </p>
          )}
        </div>

        {/* Actions dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-32 rounded-md border border-border bg-popover shadow-lg z-10">
              <button
                onClick={() => { onEdit(skill); setMenuOpen(false); }}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-secondary transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => { onExport(skill.id); setMenuOpen(false); }}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-secondary transition-colors"
              >
                Export .md
              </button>
              <button
                onClick={() => { onViewScan(skill); setMenuOpen(false); }}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-secondary transition-colors"
              >
                View Scan
              </button>
              <button
                onClick={() => { onDelete(skill.id); setMenuOpen(false); }}
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-secondary text-red-400 transition-colors"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tags */}
      {skill.meta.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {skill.meta.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Tools */}
      {skill.meta.tools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {skill.meta.tools.map((tool) => (
            <span
              key={tool}
              className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono"
            >
              {tool}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
        {skill.meta.author && <span>by {skill.meta.author}</span>}
        {skill.meta.version && <span>v{skill.meta.version}</span>}
      </div>
    </div>
  );
}
