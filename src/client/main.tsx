import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AdminApp from "./AdminApp.tsx";
import "./atelier-foundation.css";
import "./atelier-public.css";
import "./atelier-admin.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/") ? <AdminApp /> : <App />}
  </React.StrictMode>
);
