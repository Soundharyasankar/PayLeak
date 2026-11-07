import { createContext, useContext, useMemo, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("payleak-user")) || null;
    } catch (error) {
      console.error("Could not read the saved demo session.", error);
      return null;
    }
  });
  const [paypal, setPaypal] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("payleak-paypal")) || null;
    } catch (error) {
      console.error("Could not read the saved demo connection.", error);
      return null;
    }
  });

  const login = (email) => {
    const nextUser = { name: email.split("@")[0].replace(/[._-]/g, " "), email };
    localStorage.setItem("payleak-user", JSON.stringify(nextUser));
    setUser(nextUser);
  };

  const connectDemo = () => {
    const connection = {
      email: "alex.freelancer@paypal-demo.example",
      type: "PayPal Sandbox",
      connectedAt: new Date().toISOString(),
    };
    localStorage.setItem("payleak-paypal", JSON.stringify(connection));
    setPaypal(connection);
  };

  const updateProfile = (profile) => {
    const updatedUser = { ...user, ...profile };
    localStorage.setItem("payleak-user", JSON.stringify(updatedUser));
    setUser(updatedUser);
  };

  const disconnect = () => {
    localStorage.removeItem("payleak-paypal");
    setPaypal(null);
  };

  const logout = () => {
    localStorage.removeItem("payleak-user");
    localStorage.removeItem("payleak-paypal");
    setUser(null);
    setPaypal(null);
  };

  const value = useMemo(
    () => ({ user, paypal, isAuthenticated: Boolean(user), isConnected: Boolean(paypal), login, connectDemo, disconnect, logout, updateProfile }),
    [user, paypal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
