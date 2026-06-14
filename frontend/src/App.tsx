import AppModals from "./components/layout/AppModals";
import AppTitleBar from "./components/layout/AppTitleBar";
import WorkspaceLayout from "./components/layout/WorkspaceLayout";
import { useAppController } from "./hooks/useAppController";

export function App() {
  const { rootProps, titleBarProps, workspaceLayoutProps, modalProps } = useAppController();

  return (
    <div {...rootProps}>
      <AppTitleBar {...titleBarProps} />
      <WorkspaceLayout {...workspaceLayoutProps} />
      <AppModals {...modalProps} />
    </div>
  );
}
export default App;
