import { Dispatch, SetStateAction, useCallback } from "react";

import { ConfirmDialogState } from "../components/modals/ConfirmModal";
import * as api from "../services/api";
import { ActionEntry, ChatArtifact } from "../types";

type ActionPatch = Partial<ActionEntry> | ((prev: ActionEntry) => Partial<ActionEntry>);

interface UseChangeReviewActionsOptions {
  addAction: (action: Omit<ActionEntry, "id">) => string;
  updateAction: (id: string, patch: ActionPatch) => void;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState | null>>;
  setError: (message: string) => void;
}

const commitMessageForChangeReview = (artifact: ChatArtifact) => {
  const files = artifact.changed_files || [];
  if (files.length === 1) return `Apply Vodex changes to ${files[0]}`;
  return `Apply Vodex changes to ${files.length} files`;
};

export function useChangeReviewActions({
  addAction,
  updateAction,
  setConfirmDialog,
  setError,
}: UseChangeReviewActionsOptions) {
  const handleRevertChangeReview = useCallback(
    async (artifact: ChatArtifact) => {
      const files = artifact.changed_files || [];
      if (!artifact.workdir || files.length === 0) {
        setError("This change review artifact does not include files to revert.");
        return;
      }
      const actionId = addAction({
        title: "Revert Vodex changes",
        status: "running",
        detail: files.join(", "),
        workdir: artifact.workdir,
      });
      try {
        const result = await api.revertChangeReview(artifact.workdir, files);
        updateAction(actionId, {
          status: "done",
          streamingResponse: `Reverted ${result.reverted_files.length} file${result.reverted_files.length === 1 ? "" : "s"}.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to revert changes";
        updateAction(actionId, { status: "failed", streamingResponse: message });
        setError(message);
      }
    },
    [addAction, setError, updateAction],
  );

  const handleCommitChangeReview = useCallback(
    async (artifact: ChatArtifact) => {
      const files = artifact.changed_files || [];
      if (!artifact.workdir || files.length === 0) {
        setError("This change review artifact does not include files to commit.");
        return;
      }
      const message = commitMessageForChangeReview(artifact);
      const actionId = addAction({
        title: "Commit Vodex changes",
        status: "running",
        detail: message,
        workdir: artifact.workdir,
      });
      try {
        const result = await api.commitChangeReview(artifact.workdir, files, message);
        updateAction(actionId, {
          status: "done",
          streamingResponse: `Committed ${result.committed_files.length} file${result.committed_files.length === 1 ? "" : "s"} as ${result.commit}.`,
        });
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "Failed to commit changes";
        updateAction(actionId, { status: "failed", streamingResponse: messageText });
        setError(messageText);
      }
    },
    [addAction, setError, updateAction],
  );

  const confirmCommitChangeReview = useCallback(
    (artifact: ChatArtifact) => {
      const files = artifact.changed_files || [];
      setConfirmDialog({
        title: "Commit Vodex changes?",
        body: `Stage and commit ${files.length} changed file${files.length === 1 ? "" : "s"} from this turn. Other local files will not be staged.`,
        actionLabel: "Commit",
        onConfirm: () => void handleCommitChangeReview(artifact),
      });
    },
    [handleCommitChangeReview, setConfirmDialog],
  );

  const confirmRevertChangeReview = useCallback(
    (artifact: ChatArtifact) => {
      const files = artifact.changed_files || [];
      setConfirmDialog({
        title: "Revert Vodex changes?",
        body: `Restore ${files.length} changed file${files.length === 1 ? "" : "s"} from this turn back to HEAD. Untracked files in this change set will be removed.`,
        actionLabel: "Revert",
        danger: true,
        onConfirm: () => void handleRevertChangeReview(artifact),
      });
    },
    [handleRevertChangeReview, setConfirmDialog],
  );

  return { confirmCommitChangeReview, confirmRevertChangeReview };
}
