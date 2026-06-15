import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrandGuide } from "./BrandGuide";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrandGuide />
  </StrictMode>,
);
