import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrandGuide } from "./brand-guide";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrandGuide />
  </StrictMode>,
);
