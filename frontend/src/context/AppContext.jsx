import { createContext, useContext, useMemo, useState } from "react";
import { demoInvoices, demoNotifications, demoTransactions } from "../data/demoData.js";

const AppContext = createContext(null);

const loadData = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (error) {
    console.error(`Could not load ${key}; using the included demo data.`, error);
    return fallback;
  }
};

export function AppProvider({ children }) {
  const [invoices, setInvoices] = useState(() => loadData("payleak-invoices", demoInvoices));
  const [notifications, setNotifications] = useState(() => loadData("payleak-notifications", demoNotifications));
  const transactions = demoTransactions;

  const persistInvoices = (next) => {
    localStorage.setItem("payleak-invoices", JSON.stringify(next));
    setInvoices(next);
  };

  const createInvoice = (fields, status = "Draft") => {
    const invoice = {
      ...fields,
      id: `INV-DEMO-${Date.now().toString().slice(-5)}`,
      amount: Number(fields.amount),
      status,
      paypalId: `DEMO-${Date.now().toString(36).toUpperCase()}`,
      link: "https://paypal.example/demo-invoice",
    };
    persistInvoices([invoice, ...invoices]);
    return invoice;
  };

  const updateInvoiceStatus = (id, status) => {
    persistInvoices(invoices.map((invoice) => invoice.id === id ? { ...invoice, status } : invoice));
  };

  const updateNotifications = (next) => {
    localStorage.setItem("payleak-notifications", JSON.stringify(next));
    setNotifications(next);
  };

  const resetDemo = () => {
    localStorage.removeItem("payleak-invoices");
    localStorage.removeItem("payleak-notifications");
    setInvoices(demoInvoices);
    setNotifications(demoNotifications);
  };

  const value = useMemo(
    () => ({ invoices, transactions, notifications, createInvoice, updateInvoiceStatus, updateNotifications, resetDemo }),
    [invoices, transactions, notifications],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppData must be used within AppProvider");
  return context;
}
