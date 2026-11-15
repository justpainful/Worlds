import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("keeps the error a view threw", () => {
    const error = new Error("boom");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it("shows the view itself while nothing went wrong", () => {
    const b = new ErrorBoundary({ children: "page", onHome: () => {} });
    expect(b.render()).toBe("page");
  });

  it("offers Try again and Go Home inside a pane, and only a reload for the whole app", () => {
    const inPane = new ErrorBoundary({ children: null, onHome: () => {} });
    inPane.state = { error: new Error("boom") };
    const pane = renderToStaticMarkup(inPane.render() as React.ReactElement);
    expect(pane).toContain("This view stopped working");
    expect(pane).toContain("Try again");
    expect(pane).toContain("Go Home");
    expect(pane).toContain("boom");

    const app = new ErrorBoundary({ children: null });
    app.state = { error: new Error("boom") };
    const whole = renderToStaticMarkup(app.render() as React.ReactElement);
    expect(whole).toContain("Reload Worlds");
    expect(whole).not.toContain("Go Home");
  });

  it("clears the error when the pane moves to another page", () => {
    const b = new ErrorBoundary({ children: null, resetKey: "tab:a" });
    b.state = { error: new Error("boom") };
    const setState = vi.spyOn(b, "setState").mockImplementation(() => {});
    b.componentDidUpdate({ children: null, resetKey: "tab:a" });
    expect(setState).not.toHaveBeenCalled();
    b.componentDidUpdate({ children: null, resetKey: "tab:b" });
    expect(setState).toHaveBeenCalledWith({ error: null });
  });
});
