import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../js/config.js";
import App from "./App.jsx";
import "../css/style.css";

if (localStorage.getItem("taskhero-dark-mode") === "true") {
  document.body.classList.add("dark-mode");
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
