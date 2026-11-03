import { defineHexclaveConfig } from "@hexclave/js";

// Flat keys preferred by Hexclave. Mirrors the Stack/Hexclave dashboard selection:
// auth (password, OTP, Google, GitHub), emails, analytics.
export const config = defineHexclaveConfig({
  apps: {
    installed: {
      authentication: { enabled: true },
      emails: { enabled: true },
      analytics: { enabled: true },
    },
  },
  auth: {
    allowSignUp: true,
  },
  "auth.password": {
    allowSignIn: true,
  },
  "auth.otp": {
    allowSignIn: true,
  },
  "auth.passkey": {
    allowSignIn: false,
  },
  "auth.oauth": {
    accountMergeStrategy: "link_method",
    providers: {
      google: {
        type: "google",
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
      github: {
        type: "github",
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    },
  },
  emails: {
    selectedThemeId: "a0172b5d-cff0-463b-83bb-85124697373a",
  },
});
