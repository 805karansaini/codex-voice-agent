import AppErrorBoundary from "./components/common/AppErrorBoundary";
import AppModals from "./components/layout/AppModals";
import AppTitleBar from "./components/layout/AppTitleBar";
import WorkspaceLayout from "./components/layout/WorkspaceLayout";
import { useAppController } from "./hooks/useAppController";

function AppContent() {
  const { rootProps, titleBarProps, workspaceLayoutProps, modalProps } = useAppController();

  return (
    <div {...rootProps}>
      <a
        href="#message-composer"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground shadow-lg transition-transform focus:translate-y-0"
      >
        Skip to message box
      </a>
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
