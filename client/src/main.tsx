import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Retire the boot screen once the app has painted. `performance.now()` is time since the document
// started loading, so a fast connection still shows the splash briefly instead of flashing it, and a
// slow one dismisses it immediately. index.html drops it after 8s regardless, so a bundle that throws
// on the way here can never leave a visitor staring at it.
const MIN_VISIBLE_MS = 620;
const wait = Math.max(0, MIN_VISIBLE_MS - performance.now());

requestAnimationFrame(() => {
  window.setTimeout(() => {
    document.documentElement.classList.add("splash-done");
    window.setTimeout(() => document.getElementById("splash")?.remove(), 600);
  }, wait);
});
