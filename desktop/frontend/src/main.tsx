import React from "react";
import { createRoot } from "react-dom/client";
import { NetvizRoot } from "@netviz/ui";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NetvizRoot>
      <App />
    </NetvizRoot>
  </React.StrictMode>,
);
