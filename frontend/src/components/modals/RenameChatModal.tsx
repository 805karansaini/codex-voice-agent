import { useEffect, useState } from "react";
import { X } from "lucide-react";

export type RenameDialogState = {
  projectId: string;
  chatId: string;
  initialTitle: string;
};

export default function RenameChatModal({
  dialog,
  onClose,
  onRename,
}: {
  dialog: RenameDialogState;
  onClose: () => void;
  onRename: (projectId: string, chatId: string, title: string) => void;
}) {
  const [title, setTitle] = useState(dialog.initialTitle);
  const cleanTitle = title.trim();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    if (!cleanTitle) return;
    onRename(dialog.projectId, dialog.chatId, cleanTitle);
    onClose();
  };

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/60 p-4 backdrop-blur-sm"
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
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
          <h3 className="text-base font-semibold tracking-tight text-fg">Rename conversation</h3>
        </div>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
        />
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
            onClick={submit}
            disabled={!cleanTitle}
            className="rounded-md bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
