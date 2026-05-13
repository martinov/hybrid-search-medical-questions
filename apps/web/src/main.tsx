import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Could not find #root in index.html");
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
