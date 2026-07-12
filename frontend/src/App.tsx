import AppErrorBoundary from "./components/common/AppErrorBoundary";
import AppModals from "./components/layout/AppModals";
import AppTitleBar from "./components/layout/AppTitleBar";
import WorkspaceLayout from "./components/layout/WorkspaceLayout";
import { useAppController } from "./hooks/useAppController";

function AppContent() {
  const { rootProps, titleBarProps, workspaceLayoutProps, modalProps } = useAppController();

  return (
    <div {...rootProps}>
      <AppTitleBar {...titleBarProps} />
      <WorkspaceLayout {...workspaceLayoutProps} />
      <AppModals {...modalProps} />
    </div>
  );
}

export function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}

export default App;
