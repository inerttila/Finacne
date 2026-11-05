import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HexclaveProvider, HexclaveTheme } from "@hexclave/react";
import { hexclaveClientApp } from "./hexclave/client.js";
import { netHexclaveTheme } from "./hexclave/theme.js";
import App from "./App.jsx";
import SignInPage from "./auth/SignInPage.jsx";
import SignUpPage from "./auth/SignUpPage.jsx";
import "./styles.css";

const path = window.location.pathname.replace(/\/$/, "") || "/";

function AuthFallback() {
  return (
    <div className="auth-page auth-page-loading" aria-busy="true">
      <p className="eyebrow">Net</p>
      <p className="hint">One moment…</p>
    </div>
  );
}

function Root() {
  if (path === "/sign-in") return <SignInPage />;
  if (path === "/sign-up") return <SignUpPage />;
  return <App />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HexclaveProvider app={hexclaveClientApp}>
      <HexclaveTheme theme={netHexclaveTheme}>
        <Suspense fallback={<AuthFallback />}>
          <Root />
        </Suspense>
      </HexclaveTheme>
    </HexclaveProvider>
  </StrictMode>,
);
