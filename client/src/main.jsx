import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HexclaveProvider, HexclaveTheme } from "@hexclave/react";
import { hexclaveClientApp } from "./hexclave/client.js";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Suspense
      fallback={
        <div className="boot-screen">
          <p className="eyebrow boot-eyebrow">Net</p>
          <p className="boot-title">Opening your ledger</p>
          <p className="boot-copy">One moment…</p>
        </div>
      }
    >
      <HexclaveProvider app={hexclaveClientApp}>
        <HexclaveTheme>
          <App />
        </HexclaveTheme>
      </HexclaveProvider>
    </Suspense>
  </StrictMode>,
);
