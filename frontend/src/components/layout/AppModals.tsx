import type { Project } from "../../types";
import AddProjectModal from "../modals/AddProjectModal";
import ConfirmModal, { type ConfirmDialogState } from "../modals/ConfirmModal";
import RenameChatModal, { type RenameDialogState } from "../modals/RenameChatModal";

export type AppModalsProps = {
  showAdd: boolean;
  projects: Project[];
  confirmDialog: ConfirmDialogState | null;
  renameDialog: RenameDialogState | null;
  onCloseAdd: () => void;
  onCreateProject: (project: Omit<Project, "id" | "createdAt">) => void;
  onCloseConfirm: () => void;
  onCloseRename: () => void;
  onRenameChat: (projectId: string, chatId: string, title: string) => void;
};

export default function AppModals({
  showAdd,
  projects,
  confirmDialog,
  renameDialog,
  onCloseAdd,
  onCreateProject,
  onCloseConfirm,
  onCloseRename,
  onRenameChat,
}: AppModalsProps) {
  return (
    <>
      {showAdd && (
        <AddProjectModal
          onClose={onCloseAdd}
          onCreate={onCreateProject}
          usedColors={projects.map((project) => project.color)}
          existingPaths={projects.map((project) => project.path)}
        />
      )}
      {confirmDialog && <ConfirmModal dialog={confirmDialog} onClose={onCloseConfirm} />}
      {renameDialog && (
        <RenameChatModal dialog={renameDialog} onClose={onCloseRename} onRename={onRenameChat} />
      )}
    </>
  );
}
