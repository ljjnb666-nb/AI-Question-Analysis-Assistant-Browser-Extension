import { createRoot } from "react-dom/client";
import { AdminApp } from "./app";
import "./styles.css";

const rootElement = document.getElementById("admin-root");
if (rootElement) {
  createRoot(rootElement).render(<AdminApp />);
}
