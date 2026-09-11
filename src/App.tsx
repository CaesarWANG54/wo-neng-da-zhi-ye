import { MobileRuntime } from "./mobile";
import Prototype from "./Prototype";
import RuntimeErrorBoundary from "./RuntimeErrorBoundary";

function GameRuntime() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("qa") === "fatal") {
    throw new Error("QA runtime-boundary fixture");
  }
  return (
    <MobileRuntime>
      <Prototype />
    </MobileRuntime>
  );
}

export default function App() {
  return (
    <RuntimeErrorBoundary>
      <GameRuntime />
    </RuntimeErrorBoundary>
  );
}
