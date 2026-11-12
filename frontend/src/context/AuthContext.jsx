import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, endpoints, responseData } from "../services/api.js";
import { claimPaypalWelcome } from "../utils/paypalWelcome.js";
import { authErrorMessage, shouldClearAuthSession, verifySessionUser } from "../utils/authSession.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [paypal, setPaypal] = useState(null);
  const [paypalWelcomePending, setPaypalWelcomePending] = useState(false);
  const [status, setStatus] = useState("loading");
  const [paypalError, setPaypalError] = useState("");
  const [authNotice, setAuthNotice] = useState("");

  const refreshPaypalAccount = useCallback(async () => {
    try {
      const response = await api.get(endpoints.paypalAccount);
      const account = responseData(response);
      setPaypal(account);
      setPaypalError("");
      return account;
    } catch (error) {
      setPaypal(null);
      setPaypalError(error.response?.data?.error?.message || "Could not load PayPal account status.");
      return null;
    }
  }, []);

  useEffect(() => {
    const interceptorId = api.interceptors.response.use(undefined, (error) => {
      if (shouldClearAuthSession(error)) {
        const code = error.response?.data?.error?.code;
        setAuthNotice(code === "INVALID_TOKEN"
          ? "Your session expired or is no longer valid. Please sign in again."
          : "Your session is no longer active. Please sign in again.");
        setUser(null);
        setPaypal(null);
        setPaypalWelcomePending(false);
        setPaypalError("");
        setStatus("anonymous");
      }
      return Promise.reject(error);
    });
    return () => api.interceptors.response.eject(interceptorId);
  }, []);

  useEffect(() => {
    let active = true;
    api.get(endpoints.currentUser)
      .then((response) => {
        if (active) {
          setUser(responseData(response));
          setStatus("authenticated");
        }
      })
      .catch((error) => {
        if (active) {
          if (error.response?.status === 401) {
            if (error.response?.data?.error?.code === "INVALID_TOKEN") {
              setAuthNotice("Your session expired or is no longer valid. Please sign in again.");
            }
          } else {
            console.error("Could not restore the PayLeak session.", error);
            setAuthNotice(authErrorMessage(error, "PayLeak could not restore your session."));
          }
          setUser(null);
          setStatus("anonymous");
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (user) void refreshPaypalAccount();
    else {
      setPaypal(null);
      setPaypalError("");
    }
  }, [user, refreshPaypalAccount]);

  const login = useCallback(async (credentials) => {
    setAuthNotice("");
    const response = await api.post(endpoints.login, credentials);
    const data = responseData(response);
    const account = await refreshPaypalAccount();
    const sessionUser = await verifySessionUser(data.user, async () =>
      responseData(await api.get(endpoints.currentUser)));
    setPaypalWelcomePending(claimPaypalWelcome(sessionUser, Boolean(account?.connected)));
    setUser(sessionUser);
    setStatus("authenticated");
    return sessionUser;
  }, [refreshPaypalAccount]);

  const register = useCallback(async (details) => {
    setAuthNotice("");
    const response = await api.post(endpoints.register, details);
    const data = responseData(response);
    const account = await refreshPaypalAccount();
    const sessionUser = await verifySessionUser(data.user, async () =>
      responseData(await api.get(endpoints.currentUser)));
    setPaypalWelcomePending(claimPaypalWelcome(sessionUser, Boolean(account?.connected)));
    setUser(sessionUser);
    setStatus("authenticated");
    return sessionUser;
  }, [refreshPaypalAccount]);

  const updateProfile = useCallback(async (profile) => {
    const response = await api.put(endpoints.currentUser, profile);
    const updatedUser = responseData(response);
    setUser(updatedUser);
    return updatedUser;
  }, []);

  const logout = useCallback(async () => {
    await api.post(endpoints.logout);
    setUser(null);
    setPaypal(null);
    setPaypalWelcomePending(false);
    setPaypalError("");
    setAuthNotice("");
    setStatus("anonymous");
  }, []);

  const finishPaypalWelcome = useCallback(() => setPaypalWelcomePending(false), []);

  const value = useMemo(() => ({
    user,
    paypal,
    paypalWelcomePending,
    paypalError,
    authNotice,
    status,
    isAuthenticated: status === "authenticated" && Boolean(user),
    isConnected: Boolean(paypal?.connected),
    login,
    register,
    logout,
    updateProfile,
    refreshPaypalAccount,
    finishPaypalWelcome,
  }), [user, paypal, paypalWelcomePending, paypalError, authNotice, status, login, register, logout, updateProfile, refreshPaypalAccount, finishPaypalWelcome]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
