import React from "react";
import { createRoot } from "react-dom/client";
import { SidePanelApp } from "./SidePanelApp";

const root = document.getElementById("sidepanel-root");
if (root) createRoot(root).render(React.createElement(SidePanelApp));
