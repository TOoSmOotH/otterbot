import type { Project } from "@otterbot/shared";
import { MarkdownContent } from "../chat/MarkdownContent";

export function CharterView({ project }: { project: Project }) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-semibold">{project.name} Charter</h2>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              project.charterStatus === "finalized"
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-amber-500/20 text-amber-400"
            }`}
          >
            {project.charterStatus}
          </span>
        </div>

        {project.charter ? (
          <div className="prose prose-invert prose-sm max-w-none">
            <MarkdownContent content={project.charter} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">No charter yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ask the COO to create a charter for this project
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
