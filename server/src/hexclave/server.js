import { HexclaveServerApp } from "@hexclave/js";

export const hexclaveServerApp = new HexclaveServerApp({
  tokenStore: null,
  urls: {
    default: {
      type: "hosted",
    },
  },
});
