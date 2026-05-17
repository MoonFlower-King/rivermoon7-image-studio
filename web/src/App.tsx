import { Navigate, Route, Routes } from "react-router-dom";

import ImagePage from "@/app/image/page";
import AppShell from "@/app/layout";
import LoginPage from "@/app/login/page";
import HomePage from "@/app/page";
import SettingsPage from "@/app/settings/page";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/image" element={<Navigate to="/image/history" replace />} />
        <Route path="/image/history" element={<ImagePage />} />
        <Route path="/image/workspace" element={<ImagePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/accounts" element={<Navigate to="/image/history" replace />} />
        <Route path="/startup-check" element={<Navigate to="/image/history" replace />} />
        <Route path="/requests" element={<Navigate to="/image/history" replace />} />
      </Routes>
    </AppShell>
  );
}
