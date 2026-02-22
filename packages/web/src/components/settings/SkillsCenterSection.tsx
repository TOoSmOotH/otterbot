import { useEffect, useState } from "react";
import { useSkillsStore } from "../../stores/skills-store";
import { SkillCard } from "./skills/SkillCard";
import { ImportSkillDialog } from "./skills/ImportSkillDialog";
import { SkillEditorDialog } from "./skills/SkillEditorDialog";
import { ScanReportDisplay } from "./skills/ScanReportDisplay";
import type { Skill, SkillMeta, ScanReport } from "@otterbot/shared";
import matter from "gray-matter";

export function SkillsCenterSection() {
  const skills = useSkillsStore((s) => s.skills);
  const loading = useSkillsStore((s) => s.loading);
  const loadSkills = useSkillsStore((s) => s.loadSkills);
  const createSkill = useSkillsStore((s) => s.createSkill);
  const updateSkill = useSkillsStore((s) => s.updateSkill);
  const deleteSkill = useSkillsStore((s) => s.deleteSkill);
  const cloneSkill = useSkillsStore((s) => s.cloneSkill);
  const importSkill = useSkillsStore((s) => s.importSkill);
  const exportSkill = useSkillsStore((s) => s.exportSkill);
  const availableTools = useSkillsStore((s) => s.availableTools);
  const loadAvailableTools = useSkillsStore((s) => s.loadAvailableTools);

  const [importOpen, setImportOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [scanViewSkill, setScanViewSkill] = useState<Skill | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
    loadAvailableTools();
  }, []);

  const handleImport = async (file: File) => {
    const result = await importSkill(file);
    if (result) {
      return { scanReport: result.scanReport };
    }
    return null;
  };

  const handleNewSkill = () => {
    setEditingSkill(null);
    setEditorOpen(true);
  };

  const handleEditSkill = (skill: Skill) => {
    setEditingSkill(skill);
    setEditorOpen(true);
  };

  const handleSave = async (meta: SkillMeta, body: string) => {
    if (editingSkill) {
      await updateSkill(editingSkill.id, { meta, body });
    } else {
      await createSkill({ meta, body });
    }
  };

  const handleClone = async (id: string) => {
    await cloneSkill(id);
  };

  const handleDelete = async (id: string) => {
    if (confirmDelete === id) {
      await deleteSkill(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      // Auto-reset confirmation after 3 seconds
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  const serializeSkillFile = (meta: SkillMeta, body: string): string => {
    const frontmatter: Record<string, unknown> = {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
    };
    if (meta.tools.length > 0) frontmatter.tools = meta.tools;
    if (meta.capabilities.length > 0) frontmatter.capabilities = meta.capabilities;
    if (Object.keys(meta.parameters).length > 0) frontmatter.parameters = meta.parameters;
    if (meta.tags.length > 0) frontmatter.tags = meta.tags;
    return matter.stringify(body, frontmatter);
  };

  const parseSkillFile = (raw: string): { meta: SkillMeta; body: string } => {
    const { data, content } = matter(raw);
    return {
      meta: {
        name: data.name ?? "Untitled Skill",
        description: data.description ?? "",
        version: data.version ?? "1.0.0",
        author: data.author ?? "",
        tools: Array.isArray(data.tools) ? data.tools : [],
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
        parameters: (data.parameters && typeof data.parameters === "object") ? data.parameters : {},
        tags: Array.isArray(data.tags) ? data.tags : [],
      },
      body: content.trim(),
    };
  };

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold mb-1">Skills Center</h3>
          <p className="text-xs text-muted-foreground">
            Import, create, and manage skills that extend agent capabilities.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 transition-colors"
          >
            Import Skill
          </button>
          <button
            onClick={handleNewSkill}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
          >
            New Skill
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-xs text-muted-foreground py-8 text-center">
          Loading skills...
        </div>
      )}

      {/* Empty state */}
      {!loading && skills.length === 0 && (
        <div className="rounded-lg border border-border p-6 bg-secondary flex flex-col items-center justify-center text-center">
          <p className="text-xs text-muted-foreground max-w-sm">
            No skills yet. Import a skill file or create one from scratch.
            Skills provide capabilities like code review, browser automation,
            and more that can be assigned to any agent.
          </p>
        </div>
      )}

      {/* Skills grid */}
      {!loading && skills.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onEdit={handleEditSkill}
              onExport={exportSkill}
              onDelete={handleDelete}
              onClone={handleClone}
              onViewScan={setScanViewSkill}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation banner */}
      {confirmDelete && (
        <div className="text-xs text-center text-muted-foreground">
          Click Delete again to confirm removal.
        </div>
      )}

      {/* Scan view modal */}
      {scanViewSkill && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setScanViewSkill(null)}
        >
          <div
            className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold">
                Scan Report: {scanViewSkill.meta.name}
              </h3>
              <button
                onClick={() => setScanViewSkill(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <ScanReportDisplay
                report={{
                  clean: scanViewSkill.scanStatus === "clean",
                  findings: scanViewSkill.scanFindings,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Import dialog */}
      <ImportSkillDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />

      {/* Editor dialog */}
      <SkillEditorDialog
        open={editorOpen}
        skill={editingSkill}
        availableTools={availableTools}
        onClose={() => { setEditorOpen(false); setEditingSkill(null); }}
        onSave={handleSave}
        onSerialize={serializeSkillFile}
        onParse={parseSkillFile}
      />
    </div>
  );
}
