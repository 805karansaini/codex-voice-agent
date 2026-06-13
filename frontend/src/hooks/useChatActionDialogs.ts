import { useCallback, useState } from "react";

import { ConfirmDialogState } from "../components/modals/ConfirmModal";
import { RenameDialogState } from "../components/modals/RenameChatModal";

interface UseChatActionDialogsOptions {
  removeProject: (id: string) => void;
  removeChat: (projectId: string, chatId: string) => void;
}

export function useChatActionDialogs({ removeProject, removeChat }: UseChatActionDialogsOptions) {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);

  const handleRemoveProject = useCallback(
    (id: string, name: string) => {
      setConfirmDialog({
        title: "Remove project",
        body: `Remove ${name}? This clears its chats and local history.`,
        actionLabel: "Remove",
        danger: true,
        onConfirm: () => removeProject(id),
      });
    },
    [removeProject],
  );

  const handleRemoveChat = useCallback(
    (projectId: string, chatId: string) => {
      setConfirmDialog({
        title: "Delete conversation",
        body: "Delete this conversation and its local history?",
        actionLabel: "Delete",
        danger: true,
        onConfirm: () => removeChat(projectId, chatId),
      });
    },
    [removeChat],
  );

  const handleRenameChat = useCallback((projectId: string, chatId: string, title: string) => {
    setRenameDialog({ projectId, chatId, initialTitle: title });
  }, []);

  return {
    confirmDialog,
    setConfirmDialog,
    renameDialog,
    setRenameDialog,
    handleRemoveProject,
    handleRemoveChat,
    handleRenameChat,
  };
}
