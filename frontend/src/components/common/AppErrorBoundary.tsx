import { Component, type ReactNode } from "react";
import { Check, Clipboard, RefreshCw, TriangleAlert } from "lucide-react";

type CopyState = "idle" | "copied" | "failed";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  copyState: CopyState;
};

const INITIAL_STATE: AppErrorBoundaryState = {
  hasError: false,
  copyState: "idle",
};

function safeDiagnosticText(): string {
  return [
    "Vodex recovery report",
    `Recorded: ${new Date().toISOString()}`,
    `Build mode: ${import.meta.env.MODE}`,
    "Issue: The app displayed its recovery screen after an unexpected interface error.",
    "Error details are intentionally omitted to protect private data.",
  ].join("\n");
}

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state = INITIAL_STATE;

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { hasError: true };
  }

  private reloadApp = () => {
    window.location.reload();
  };

  private copyDiagnostics = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable");
      }

      await navigator.clipboard.writeText(safeDiagnosticText());
      this.setState({ copyState: "copied" });
    } catch {
      this.setState({ copyState: "failed" });
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="workspace-canvas grid min-h-full place-items-center p-5 sm:p-8">
        <section
          role="alert"
          aria-labelledby="app-error-title"
          aria-describedby="app-error-description"
          className="panel surface-elevated w-full max-w-lg p-6 sm:p-8"
        >
          <div
            aria-hidden="true"
            className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-danger/35 bg-danger/10 text-danger"
          >
            <TriangleAlert className="h-5 w-5" />
          </div>

          <p className="label mb-2">Vodex recovery</p>
          <h1 id="app-error-title" className="text-xl font-semibold tracking-tight text-fg">
            The app hit a problem
          </h1>
          <p id="app-error-description" className="mt-3 text-[13px] leading-relaxed text-fg-muted">
            Something unexpected stopped the interface. Reload the app to try again. Your saved
            chats and projects should remain available, but any unsent text may be lost.
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={this.reloadApp}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-foreground transition-all hover:brightness-110"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Reload app
            </button>
            <button
              type="button"
              onClick={() => void this.copyDiagnostics()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2 text-[12.5px] font-semibold text-fg transition-colors hover:bg-surface-3"
            >
              {this.state.copyState === "copied" ? (
                <Check aria-hidden="true" className="h-4 w-4 text-success" />
              ) : (
                <Clipboard aria-hidden="true" className="h-4 w-4" />
              )}
              {this.state.copyState === "copied" ? "Diagnostics copied" : "Copy diagnostics"}
            </button>
          </div>

          <p
            role="status"
            aria-live="polite"
            className="mt-3 min-h-5 text-[11.5px] leading-relaxed text-fg-dim"
          >
            {this.state.copyState === "failed"
              ? "The clipboard was unavailable. Reload the app and try again."
              : this.state.copyState === "copied"
                ? "Diagnostics copied. The report excludes messages, file contents, links, and error details."
                : "Diagnostics exclude messages, file contents, links, and error details."}
          </p>
        </section>
      </main>
    );
  }
}
