import React, { useEffect } from "react";
import { ShieldAlert, X } from "lucide-react";
import { PendingAction } from "../../types";

interface ActionPreviewModalProps {
  action: PendingAction;
  onCancel: () => void;
  onRun: () => void;
}

export const ActionPreviewModal: React.FC<ActionPreviewModalProps> = ({
  action,
  onCancel,
  onRun,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onRun]);

  return (
    <div
      onMouseDown={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/60 backdrop-blur-sm p-4"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg rounded-xl border border-danger/30 bg-surface-1 p-6 shadow-xl flex flex-col gap-5 animate-in fade-in duration-200"
      >
        {/* Close Button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-fg-dim hover:text-fg hover:bg-surface-2 p-1 rounded-md transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex flex-col gap-1.5 pr-6">
          <h3 className="text-base font-semibold tracking-tight text-fg">Review command execution</h3>
          <p className="text-[12.5px] text-fg-muted leading-relaxed">
            The requested task was flagged because it performs operations that modify code, dependencies, or git history.
          </p>
        </div>

        {/* Warning Indicator */}
        <div className="flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn/5 p-3 text-xs text-warn font-mono">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{action.reason}</span>
        </div>

        {/* Action Details Grid */}
        <div className="grid grid-cols-2 gap-4 text-xs font-mono border-t border-b border-line-soft py-3">
          <div>
            <span className="text-[9px] uppercase font-bold tracking-wider text-fg-dim block mb-1">Target Workspace</span>
            <span className="text-fg font-semibold">{action.project.name}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase font-bold tracking-wider text-fg-dim block mb-1">Operator Mode</span>
            <span className="text-accent font-semibold">{action.mode === "codex" ? "Codex Direct" : "Agent"}</span>
          </div>
          <div className="col-span-2">
            <span className="text-[9px] uppercase font-bold tracking-wider text-fg-dim block mb-1">Absolute path</span>
            <code className="text-fg-muted break-all text-[11px] block bg-surface-2/60 border border-line-soft rounded px-1.5 py-0.5 mt-0.5">
              {action.project.path}
            </code>
          </div>
        </div>

        {/* Command Task Prompt */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-dim font-bold">
            Requested Task
          </span>
          <p className="bg-surface-2 border border-line rounded-md p-3 font-mono text-[12px] text-fg-muted leading-relaxed whitespace-pre-wrap break-all">
            {action.text}
          </p>
        </div>

        {/* Footer Buttons */}
        <div className="flex justify-end gap-2.5 mt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-[12.5px] font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRun}
            className="rounded-md bg-danger px-4 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 transition-colors shadow-sm"
          >
            Execute command
          </button>
        </div>
      </div>
    </div>
  );
};
export default ActionPreviewModal;
