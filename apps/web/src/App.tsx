import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { canAccess } from "./lib/personas";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { CommandCentre } from "./pages/CommandCentre";
import { Incidents } from "./pages/Incidents";
import { WorkOrders, Field } from "./pages/WorkOrders";
import { Twin } from "./pages/Twin";
import { Analytics } from "./pages/Analytics";
import { Department } from "./pages/Department";
import { Ops } from "./pages/Ops";
import { Admin } from "./pages/Admin";
import { Platform } from "./pages/Platform";
import { Citizen } from "./pages/Citizen";
import { Assets } from "./pages/Assets";
import { Onboard } from "./pages/Onboard";
import type { ReactNode } from "react";

function Guard({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const loc = useLocation();
  if (!me) return <Navigate to="/login" replace />;
  if (!canAccess(me.roles, loc.pathname, me.city?.modules)) return <Navigate to={me.home} replace />;
  return <>{children}</>;
}

export function App() {
  const { me, ready } = useAuth();
  if (!ready) return <div className="login"><div className="card">Loading…</div></div>;
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to={me.home} replace /> : <Login />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/overview" element={<Overview />} />
        <Route path="/command-centre" element={<CommandCentre />} />
        <Route path="/incidents" element={<Incidents />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/field" element={<Field />} />
        <Route path="/twin" element={<Twin />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/department" element={<Department />} />
        <Route path="/ops" element={<Ops />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/platform" element={<Platform />} />
        <Route path="/citizen" element={<Citizen />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/assets/onboard" element={<Onboard />} />
      </Route>
      <Route path="*" element={<Navigate to={me ? me.home : "/login"} replace />} />
    </Routes>
  );
}
