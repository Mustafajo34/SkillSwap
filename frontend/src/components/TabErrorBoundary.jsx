import { Component } from "react";

// Keeps a problem in one dashboard tab inside that tab. If the tab's file
// couldn't be downloaded, or the tab crashes while running, only the content
// area shows this message — the navbar, sidebar and other tabs keep working.
// The Dashboard gives each tab its own boundary (key = tab id), so switching
// tabs clears the error. "Try again" asks the Dashboard for a fresh copy of
// the tab (onRetry) and re-renders it.

export default class TabErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Dashboard tab failed:", error, info?.componentStack);
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return (
      <div
        role="alert"
        className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <span
          className="grid h-12 w-12 place-items-center rounded-full text-xl font-bold"
          style={{ background: "var(--muted)", color: "var(--foreground)" }}
          aria-hidden="true"
        >
          !
        </span>
        <h2 className="text-lg font-bold" style={{ color: "var(--foreground)" }}>
          This section couldn’t load
        </h2>
        <p className="max-w-sm text-sm" style={{ color: "var(--muted-foreground)" }}>
          {offline
            ? "You seem to be offline. Check your connection, then try again."
            : "Something went wrong loading this part of SkillSwap. The rest of the app still works."}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={this.retry}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--muted)]"
            style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
