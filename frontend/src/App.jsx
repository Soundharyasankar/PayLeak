import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { AppProvider } from "./context/AppContext.jsx";
import AppLayout from "./layouts/AppLayout.jsx";

const Login = lazy(() => import("./pages/Login.jsx"));
const Register = lazy(() => import("./pages/Register.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const ConnectPayPal = lazy(() => import("./pages/ConnectPayPal.jsx"));
const SandboxCheckout = lazy(() => import("./pages/SandboxCheckout.jsx"));
const PayPalCaptureReturn = lazy(() => import("./pages/PayPalReturn.jsx").then((module) => ({ default: module.PayPalCaptureReturn })));
const PayPalCancelReturn = lazy(() => import("./pages/PayPalReturn.jsx").then((module) => ({ default: module.PayPalCancelReturn })));
const Invoices = lazy(() => import("./pages/Invoices.jsx"));
const InvoiceDetails = lazy(() => import("./pages/InvoiceDetails.jsx"));
const CreateInvoice = lazy(() => import("./pages/CreateInvoice.jsx"));
const LeakAnalysis = lazy(() => import("./pages/LeakAnalysis.jsx"));
const AIAssistant = lazy(() => import("./pages/AIAssistant.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const TransactionHistory = lazy(() => import("./pages/TransactionHistory.jsx"));

function AppRoutes() {
  const { isAuthenticated, status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <div className="page-loading"><span className="spinner" /> Restoring secure session…</div>;
  }

  if (!isAuthenticated && !["/login", "/register"].includes(location.pathname)) {
    return <Navigate to="/login" replace />;
  }

  if (isAuthenticated && ["/login", "/register"].includes(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<div className="page-loading"><span className="spinner" /> Loading workspace…</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/connect-paypal" element={<ConnectPayPal />} />
        <Route path="/paypal/sandbox-checkout" element={<SandboxCheckout />} />
        <Route path="/paypal/return" element={<PayPalCaptureReturn />} />
        <Route path="/paypal/cancel" element={<PayPalCancelReturn />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/transactions" element={<TransactionHistory />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/create" element={<CreateInvoice />} />
          <Route path="/invoices/:invoiceId" element={<InvoiceDetails />} />
          <Route path="/leak-analysis" element={<LeakAnalysis />} />
          <Route path="/ai-assistant" element={<AIAssistant />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <AppRoutes />
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
