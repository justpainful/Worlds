import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** A new value clears the error, so moving to another page or tab shows it normally. */
  resetKey?: unknown;
  /** Leave the broken view for Home. Without it the only way out is a reload. */
  onHome?: () => void;
};
type State = { error: Error | null };

/**
 * Keeps a crash inside the view that had it. Without a boundary React drops
 * the whole window, so one faulty page left an empty Worlds; now the other
 * panes, the sidebar and the window controls keep working.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("A view stopped working", error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { onHome } = this.props;
    return (
      <div className="view-error" role="alert">
        <h2 className="view-error-title">This view stopped working</h2>
        <p className="view-error-text">{onHome ? "Worlds is still running. Try again, or go back Home." : "Reload Worlds to carry on."}</p>
        <div className="view-error-actions">
          {onHome ? (
            <>
              <button type="button" className="btn btn-tinted btn-standard" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
              <button type="button" className="btn btn-plain btn-standard" onClick={onHome}>
                Go Home
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-tinted btn-standard" onClick={() => location.reload()}>
              Reload Worlds
            </button>
          )}
        </div>
        <pre className="view-error-detail" translate="no">
          {error.message}
        </pre>
      </div>
    );
  }
}
