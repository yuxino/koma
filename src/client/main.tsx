import { StrictMode, type ComponentType } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "./styles/atelier-foundation.css";

const isAdminRoute = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");

function renderRoute(RouteApp: ComponentType) {
  const root = document.getElementById("root")!;
  const app = (
    <StrictMode>
      <RouteApp />
    </StrictMode>
  );
  if (!isAdminRoute && root.dataset.prerendered === "true") hydrateRoot(root, app);
  else createRoot(root).render(app);
}

if (isAdminRoute) {
  void import("./features/admin/AdminApp.tsx").then(({ default: AdminApp }) => renderRoute(AdminApp));
} else {
  void import("./features/analyzer/App.tsx").then(({ default: App }) => renderRoute(App));
}
