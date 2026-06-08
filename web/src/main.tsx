import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main>
      <h1>NetViz Server</h1>
      <p>Server/probe mode is planned for v0.1.5.</p>
      <p>The current Docker image exposes health, version, and placeholder scan APIs.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

