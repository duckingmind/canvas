import { createRoot } from "react-dom/client";
import Workspace from "./Workspace";
import { client } from "./platform-client";
import PlatformGate from "./PlatformGate";
import { installCanvasDiagnosticHandlers } from "./client-diagnostics.ts";
import "./styles.css";

const uninstallDiagnostics = installCanvasDiagnosticHandlers();
if (import.meta.hot) import.meta.hot.dispose(uninstallDiagnostics);

createRoot(document.getElementById("root")!).render(
  <PlatformGate client={client}>
    <Workspace />
  </PlatformGate>,
);
