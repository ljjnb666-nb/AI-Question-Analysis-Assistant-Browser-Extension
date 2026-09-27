import {
  installContentMainBootstrapListener,
  type RuntimeBootstrapModule,
} from "./contentMainBootstrap";

installContentMainBootstrapListener(chrome.runtime.onMessage, async () => {
  const runtimeUrl = chrome.runtime.getURL("content/contentRuntimeBootstrap.js");
  return import(/* @vite-ignore */ runtimeUrl) as Promise<RuntimeBootstrapModule>;
});
