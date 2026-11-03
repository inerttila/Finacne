import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HexclaveProvider, HexclaveTheme } from "@hexclave/react";
import { hexclaveClientApp } from "./hexclave/client.js";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HexclaveProvider app={hexclaveClientApp}>
      <HexclaveTheme>
        <App />
      </HexclaveTheme>
    </HexclaveProvider>
  </StrictMode>,
);
