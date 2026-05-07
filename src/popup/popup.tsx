import React from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "./PopupApp";

const root = document.getElementById("popup-root");
if (root) {
  createRoot(root).render(React.createElement(PopupApp));
}
