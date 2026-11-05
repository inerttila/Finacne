import { HexclaveClientApp } from "@hexclave/react";

const projectId =
  import.meta.env.VITE_HEXCLAVE_PROJECT_ID
  || import.meta.env.HEXCLAVE_PROJECT_ID
  || "";

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
  throw new Error(
    "Missing Hexclave project ID. Set VITE_HEXCLAVE_PROJECT_ID in the root .env (and rebuild Docker with that build arg).",
  );
}

export const hexclaveClientApp = new HexclaveClientApp({
  tokenStore: "cookie",
  projectId,
  urls: {
    default: {
      type: "hosted",
    },
    signIn: { type: "custom", url: "/sign-in", version: 1 },
    signUp: { type: "custom", url: "/sign-up", version: 1 },
    afterSignIn: "/",
    afterSignUp: "/",
    afterSignOut: "/",
    home: "/",
  },
});

hexclaveClientApp.initAnalytics();
