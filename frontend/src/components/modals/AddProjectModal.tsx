import React, { useState, useEffect, useRef } from "react";
import { FolderOpen, Plugs } from "@phosphor-icons/react";
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
      // Handle directory does not exist or backend offline
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
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modalHead">
          <h3>Add a project</h3>
          <p>
            Point the agent at an existing folder on this machine. It works in that folder <strong>in place</strong> —
            nothing is copied, so your original files are the only files.
          </p>
        </div>
        <div className="modalBody">
          <div className="field">
            <label htmlFor="pName">Project name</label>
            <input
              id="pName"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Codex Voice Agent"
              onKeyDown={(e) => e.key === "Enter" && (document.getElementById("pPath") as HTMLInputElement)?.focus()}
            />
          </div>
          <div className="field">
            <label htmlFor="pPath">Directory (absolute path)</label>
            <div className="pathRow">
              <input
                id="pPath"
                ref={pathRef}
                className="mono"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  if (error) setError("");
                }}
                placeholder="/Users/you/Projects/my-app"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              <button className="browseBtn" type="button" onClick={browse} disabled={picking}>
                <FolderOpen size={16} weight="bold" /> {picking ? "Opening…" : "Browse"}
              </button>
            </div>
            <p className="hint">
              Click <strong>Browse</strong> to pick a folder with the native dialog (fills the real absolute path), or
              paste a full path like <span className="mono">/Users/karansaini/Projects/app</span>.
            </p>
          </div>
          <div className="field">
            <label>Accent</label>
            <div className="swatches">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch ${c === color ? "on" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Accent ${c}`}
                />
              ))}
            </div>
          </div>
          {error && (
            <div className="modalError">
              <Plugs size={15} weight="bold" /> {error}
            </div>
          )}
        </div>
        <div className="modalFoot">
          <button className="btnGhost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btnPrimary"
            type="button"
            onClick={submit}
            disabled={!name.trim() || !path.trim() || checking}
          >
            {checking ? "Checking…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
};
export default AddProjectModal;
