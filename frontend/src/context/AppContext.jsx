import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { fetchAnalytics } from "../services/analyticsService.js";
import { deleteInvoice as deleteInvoiceApi, fetchInvoices, publishInvoiceToPaypal as publishInvoiceToPaypalApi, saveInvoice, saveLocalInvoiceDraft as saveLocalInvoiceDraftApi, sendInvoice as sendInvoiceApi, syncPaypalInvoices as syncPaypalInvoicesApi, updateInvoice as updateInvoiceApi } from "../services/invoiceService.js";
import { deleteNotification, fetchNotifications, markAllNotificationsRead, setNotificationRead } from "../services/notificationService.js";
import { fetchTransactions, syncTransactions as syncPaypalTransactions } from "../services/transactionService.js";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!user) {
      setInvoices([]);
      setTransactions([]);
      setNotifications([]);
      setAnalytics(null);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [nextInvoices, nextTransactions, nextNotifications, nextAnalytics] = await Promise.all([
        fetchInvoices(),
        fetchTransactions(),
        fetchNotifications(),
        fetchAnalytics(),
      ]);
      setInvoices(nextInvoices);
      setTransactions(nextTransactions);
      setNotifications(nextNotifications);
      setAnalytics(nextAnalytics);
    } catch (requestError) {
      console.error("Could not load PayLeak account data.", requestError);
      const status = requestError.response?.status;
      const message = status === 401
        ? "Your session is missing or expired. Please sign in again."
        : status === 403
          ? "You do not have permission to access this account data."
          : requestError.response?.data?.error?.message || requestError.message || "Could not load account data.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createInvoice = useCallback(async (fields, idempotencyKey) => {
    const invoice = await saveInvoice({ ...fields, amount: String(fields.amount) }, idempotencyKey);
    setInvoices((current) => [invoice, ...current]);
    return invoice;
  }, []);

  const createLocalInvoiceDraft = useCallback(async (fields, assistantSessionId) => {
    const invoice = await saveLocalInvoiceDraftApi({ ...fields, amount: String(fields.amount) }, assistantSessionId);
    setInvoices((current) => [invoice, ...current.filter((item) => item.id !== invoice.id)]);
    return invoice;
  }, []);

  const sendInvoice = useCallback(async (id) => {
    const invoice = await sendInvoiceApi(id);
    setInvoices((current) => current.map((item) => item.id === id ? invoice : item));
    return invoice;
  }, []);

  const publishInvoiceToPaypal = useCallback(async (id, idempotencyKey) => {
    const invoice = await publishInvoiceToPaypalApi(id, idempotencyKey);
    setInvoices((current) => current.map((item) => item.id === id ? invoice : item));
    return invoice;
  }, []);

  const updateInvoice = useCallback(async (id, fields) => {
    const invoice = await updateInvoiceApi(id, fields);
    setInvoices((current) => current.map((item) => item.id === id ? invoice : item));
    return invoice;
  }, []);

  const deleteInvoice = useCallback(async (id) => {
    await deleteInvoiceApi(id);
    setInvoices((current) => current.filter((item) => item.id !== id));
  }, []);

  const syncTransactions = useCallback(async (startDate, endDate) => {
    const result = await syncPaypalTransactions(startDate, endDate);
    const [nextTransactions, nextAnalytics] = await Promise.all([fetchTransactions(), fetchAnalytics()]);
    setTransactions(nextTransactions);
    setAnalytics(nextAnalytics);
    return result;
  }, []);

  const syncInvoices = useCallback(async () => {
    const result = await syncPaypalInvoicesApi();
    const [nextInvoices, nextAnalytics] = await Promise.all([fetchInvoices(), fetchAnalytics()]);
    setInvoices(nextInvoices);
    setAnalytics(nextAnalytics);
    return result;
  }, []);

  const updateNotification = useCallback(async (id, read) => {
    await setNotificationRead(id, read);
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, unread: read } : item));
  }, []);

  const updateNotifications = useCallback(async () => {
    await markAllNotificationsRead();
    setNotifications((current) => current.map((item) => ({ ...item, unread: false })));
  }, []);

  const removeNotification = useCallback(async (id) => {
    await deleteNotification(id);
    setNotifications((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => ({
    invoices,
    transactions,
    notifications,
    analytics,
    loading,
    error,
    refresh,
    createInvoice,
    createLocalInvoiceDraft,
    sendInvoice,
    publishInvoiceToPaypal,
    updateInvoice,
    deleteInvoice,
    syncTransactions,
    syncInvoices,
    updateNotification,
    updateNotifications,
    removeNotification,
  }), [
    invoices, transactions, notifications, analytics, loading, error, refresh,
    createInvoice, createLocalInvoiceDraft, sendInvoice, publishInvoiceToPaypal, updateInvoice, deleteInvoice, syncTransactions, syncInvoices, updateNotification, updateNotifications, removeNotification,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppData must be used within AppProvider");
  return context;
}
