import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AdminApp from "./AdminApp.tsx";
import "./styles.css";
import "./hallmark.css";
import "./mobile-header.css";
import "./light-theme.css";
import "./home.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/") ? <AdminApp /> : <App />}
  </React.StrictMode>
);
