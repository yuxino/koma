import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import "./styles/atelier-foundation.css";

const isAdminRoute = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");

function renderRoute(RouteApp: ComponentType) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouteApp />
    </StrictMode>
  );
}

if (isAdminRoute) {
  void import("./features/admin/AdminApp.tsx").then(({ default: AdminApp }) => renderRoute(AdminApp));
} else {
  void import("./features/analyzer/App.tsx").then(({ default: App }) => renderRoute(App));
}
