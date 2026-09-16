import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// M1 只验证构建链路通，UI 留到垂直切片阶段。
function App() {
  return <div>Dummy Git</div>;
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("missing #root");
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
