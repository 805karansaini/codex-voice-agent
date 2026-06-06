import React, { useState, useEffect, useRef } from "react";
import { FolderOpen, AlertCircle, X } from "lucide-react";
import { Project } from "../../types";
import * as api from "../../services/api";

const PROJECT_COLORS = ["#c8f23a", "#f3b85a", "#7fd1c4", "#8ab4ff", "#ff9f7a", "#c79bff"];

interface AddProjectModalProps {
  onClose: () => void;
  onCreate: (project: Omit<Project, "id" | "createdAt">) => void;
  usedColors: string[];
  existingPaths: string[];
}

function normalizePath(raw: string): string {
  let p = raw.trim();
  if (p.length > 1 && p.endsWith("/")) {
    p = p.replace(/\/+$/, "");
  }
  return p;
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  onClose,
  onCreate,
  usedColors,
  existingPaths,
}) => {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const nextColor = PROJECT_COLORS.find((c) => !usedColors.includes(c)) || PROJECT_COLORS[0];
  const [color, setColor] = useState(nextColor);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [picking, setPicking] = useState(false);
  const pathRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const browse = async () => {
    setError("");
    setPicking(true);
    try {
      const data = await api.pickFolder();
      if (data.cancelled || !data.path) return;
      setPath(data.path);
      if (!name.trim()) {
        setName(data.path.split("/").filter(Boolean).pop() || "");
      }
    } catch (err) {
      setError(
        err instanceof Error && /not available/i.test(err.message)
          ? err.message
          : "Couldn’t open the native folder picker. Paste the absolute path instead."
      );
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanPath = normalizePath(path);
    if (!cleanName || !cleanPath) return;
    setError("");
    setChecking(true);
    try {
      const info = await api.getProjectInfo(cleanPath);
      const resolved = info.path || cleanPath;
      if (existingPaths.includes(resolved)) {
        setError("This folder is already a project.");
        return;
      }
      onCreate({ name: cleanName, path: resolved, color });
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        setError("That directory does not exist. Paste the full absolute path to an existing folder.");
      } else {
        setError("That directory does not exist. Check the path or is the backend running?");
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/60 backdrop-blur-sm p-4"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="relative w-[95vw] sm:w-full max-w-lg rounded-xl border border-line bg-surface-1 p-5 sm:p-6 shadow-xl flex flex-col gap-5 animate-in fade-in duration-200"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-fg-dim hover:text-fg hover:bg-surface-2 p-1 rounded-md transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex flex-col gap-1.5 pr-6">
          <h3 className="text-base font-semibold tracking-tight text-fg">Add a Project Workspace</h3>
          <p className="text-[12.5px] text-fg-muted leading-relaxed">
            Scope the operator to an existing directory on your disk.
            Nothing is copied or duplicated — changes are made <strong>directly in place</strong>.
          </p>
        </div>

        {/* Form Body */}
        <div className="flex flex-col gap-4 py-1">
          {/* Project Name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pName" className="font-mono text-[10.5px] uppercase tracking-wider text-fg-dim font-bold">
              Project Name
            </label>
            <input
              id="pName"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Awesome App"
              onKeyDown={(e) => e.key === "Enter" && (document.getElementById("pPath") as HTMLInputElement)?.focus()}
              className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-fg focus:border-accent focus:outline-none placeholder:text-fg-dim"
            />
          </div>

          {/* Absolute Directory Path */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pPath" className="font-mono text-[10.5px] uppercase tracking-wider text-fg-dim font-bold">
              Absolute Directory Path
            </label>
            <div className="flex gap-2">
              <input
                id="pPath"
                className="flex-1 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13.5px] font-mono text-fg focus:border-accent focus:outline-none placeholder:text-fg-dim"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  if (error) setError("");
                }}
                placeholder="/Users/username/Projects/my-app"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              <button
                type="button"
                onClick={browse}
                disabled={picking}
                className="flex items-center gap-1.5 shrink-0 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] font-medium text-fg hover:bg-surface-3 transition-colors disabled:opacity-50"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>{picking ? "Opening…" : "Browse"}</span>
              </button>
            </div>
            <p className="text-[11px] text-fg-dim leading-normal mt-0.5">
              Paste the full absolute path, or click <strong>Browse</strong> to select via your operating system directory dialog.
            </p>
          </div>

          {/* Accent Color picker */}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-dim font-bold">
              Workspace Accent Color
            </span>
            <div className="flex items-center gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-all border-2 ${
                    c === color ? "border-fg scale-110 shadow-sm" : "border-transparent opacity-85 hover:opacity-100 hover:scale-105"
                  }`}
                  style={{ background: c }}
                  aria-label={`Color swatch ${c}`}
                />
              ))}
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger/5 p-3 text-xs text-danger font-mono mt-1">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="flex justify-end gap-2.5 mt-2 pt-2 border-t border-line-soft">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[12.5px] font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || !path.trim() || checking}
            className="rounded-md bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-foreground hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm glow-accent"
          >
            {checking ? "Checking…" : "Link Directory"}
          </button>
        </div>
      </div>
    </div>
  );
};
export default AddProjectModal;
