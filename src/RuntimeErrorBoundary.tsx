import { Component, createRef, type ErrorInfo, type ReactNode } from "react";

interface RuntimeErrorBoundaryProps {
  children: ReactNode;
}

interface RuntimeErrorBoundaryState {
  failed: boolean;
}

/**
 * Last-resort recovery for an unexpected render/runtime failure. Career data
 * is intentionally left untouched: reloading may recover the UI without
 * destroying the player's last committed save.
 */
export default class RuntimeErrorBoundary extends Component<RuntimeErrorBoundaryProps, RuntimeErrorBoundaryState> {
  state: RuntimeErrorBoundaryState = { failed: false };
  private readonly recoveryRef = createRef<HTMLElement>();

  static getDerivedStateFromError(): RuntimeErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    document.documentElement.classList.remove("native-phone", "native-landscape", "native-portrait");
    console.error("[runtime-recovery] Unexpected game error", error, info.componentStack);
    window.requestAnimationFrame(() => this.recoveryRef.current?.focus());
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main ref={this.recoveryRef} className="runtime-error-screen" data-testid="runtime-error-screen" role="alert" tabIndex={-1} aria-labelledby="runtime-error-title">
        <section>
          <small>运行保护</small>
          <h1 id="runtime-error-title">游戏暂时无法继续</h1>
          <p>界面发生了意外错误。已提交的生涯存档不会被自动删除；重新加载后会从最近一次安全存档继续。</p>
          <button type="button" data-testid="runtime-error-reload" onClick={() => window.location.reload()}>重新加载游戏</button>
        </section>
      </main>
    );
  }
}
