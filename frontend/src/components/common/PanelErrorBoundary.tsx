import { Component, Fragment, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

type PanelErrorBoundaryProps = {
  /** Names the failed region, e.g. "Console". Shown to the viewer. */
  name: string;
  children: ReactNode;
};

type PanelErrorBoundaryState = {
  hasError: boolean;
  /** Bumped on retry so the failed subtree remounts from scratch. */
  attempt: number;
};

/**
 * Contains a render failure to one region of the workspace. Without this every
 * panel shares the root boundary, so a single bad panel replaces the whole app
 * with the recovery screen and the viewer loses the rest of their workspace.
 */
export default class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { hasError: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<PanelErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // This app runs locally, so the browser console is the operator's log.
    console.error(`[vodex] ${this.props.name} panel failed to render`, error);
  }

  private retry = () => {
    this.setState((previous) => ({ hasError: false, attempt: previous.attempt + 1 }));
  };

  render() {
    if (!this.state.hasError) {
      // A keyed Fragment remounts the subtree on retry without adding a wrapper
      // element, which would otherwise break each panel's flex sizing.
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    }

    return (
      <div
        role="alert"
        className="flex h-full min-w-[220px] shrink-0 flex-col items-center justify-center gap-3 bg-surface-1 p-6 text-center"
      >
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-danger/35 bg-danger/10 text-danger">
          <TriangleAlert aria-hidden="true" className="h-4 w-4" />
        </div>
        <p className="text-[13px] font-semibold text-fg">{this.props.name} stopped responding</p>
        <p className="max-w-xs text-[11.5px] leading-relaxed text-fg-muted">
          The rest of the workspace is still available. Try loading this panel again.
        </p>
        <button
          type="button"
          onClick={this.retry}
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[11.5px] font-semibold text-fg transition-colors hover:bg-surface-3"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  }
}
