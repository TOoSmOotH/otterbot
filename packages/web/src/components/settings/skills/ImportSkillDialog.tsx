import { useState, useRef, useCallback } from "react";
import type { ScanReport } from "@otterbot/shared";
import { ScanReportDisplay } from "./ScanReportDisplay";

interface ImportSkillDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (file: File) => Promise<{ scanReport: ScanReport } | null>;
}

export function ImportSkillDialog({ open, onClose, onImport }: ImportSkillDialogProps) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [importedFileName, setImportedFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setScanReport(null);
    setImportedFileName("");
    setImporting(false);
    setDragging(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".md")) {
      return;
    }
    setImportedFileName(file.name);
    setImporting(true);
    const result = await onImport(file);
    setImporting(false);
    if (result) {
      setScanReport(result.scanReport);
      if (result.scanReport.clean) {
        // Auto-close on clean import after a brief pause
        setTimeout(handleClose, 800);
      }
    }
  }, [onImport, handleClose]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
      onClick={handleClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Import Skill</h3>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer transition-colors ${
              dragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <svg
              className="w-8 h-8 text-muted-foreground mb-2"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-xs text-muted-foreground">
              Drop a <span className="font-mono">.md</span> skill file here, or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md"
              className="hidden"
              onChange={handleInputChange}
            />
          </div>

          {/* Status */}
          {importing && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle
                  cx="12" cy="12" r="10"
                  stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25"
                />
                <path
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  opacity="0.75"
                />
              </svg>
              Importing {importedFileName}...
            </div>
          )}

          {/* Scan report */}
          {scanReport && !importing && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Scan Results
              </p>
              <ScanReportDisplay report={scanReport} />
              {!scanReport.clean && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={handleClose}
                    className="text-xs bg-secondary text-foreground px-3 py-1.5 rounded-md hover:bg-secondary/80 transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
