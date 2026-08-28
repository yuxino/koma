import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import "./atelier-foundation.css";

const isAdminRoute = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");

function renderRoute(RouteApp: ComponentType) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouteApp />
    </StrictMode>
  );
}

if (isAdminRoute) {
  void import("./AdminApp.tsx").then(({ default: AdminApp }) => renderRoute(AdminApp));
} else {
  void import("./App.tsx").then(({ default: App }) => renderRoute(App));
}
