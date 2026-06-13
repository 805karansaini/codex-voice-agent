import { useRef } from "react";
import { X } from "lucide-react";

import { cn } from "../../utils";
import { useDialogFocus } from "./useDialogFocus";

export type ConfirmDialogState = {
  title: string;
  body: string;
  actionLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

export default function ConfirmModal({
  dialog,
  onClose,
}: {
  dialog: ConfirmDialogState;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(dialogRef, onClose);

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/60 p-4 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="relative flex w-[95vw] max-w-sm flex-col gap-4 rounded-xl border border-line bg-surface-1 p-5 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="pr-6">
          <h3 className="text-base font-semibold tracking-tight text-fg">{dialog.title}</h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">{dialog.body}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line-soft pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-[12.5px] font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              dialog.onConfirm();
              onClose();
            }}
            className={cn(
              "rounded-md px-3 py-2 text-[12.5px] font-semibold text-white transition-all hover:brightness-110",
              dialog.danger ? "bg-danger" : "bg-accent text-accent-foreground",
            )}
          >
            {dialog.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
