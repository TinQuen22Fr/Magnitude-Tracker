import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import nightSkyBg from "@/assets/night-sky.webp";

// Injecte l'URL de l'image stellaire (résolue par webpack avec hash de cache)
// comme variable CSS globale lue par body { background-image: var(--app-bg-image) }.
// Cette indirection contourne la résolution stricte des URL absolues par
// css-loader, et permet de bénéficier du content-hashing en prod.
document.documentElement.style.setProperty(
  "--app-bg-image",
  `url(${nightSkyBg})`,
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
