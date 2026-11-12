import { useState } from "react";
import { Bell, Check, KeyRound, Link2, LogOut, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Panel from "../components/Panel.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function Settings() {
  const { user, paypal, paypalError, logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [savingProfile, setSavingProfile] = useState(false);
  const [currency, setCurrency] = useState(localStorage.getItem("payleak-currency") || "USD");
  const [timezone, setTimezone] = useState(localStorage.getItem("payleak-timezone") || "Asia/Kolkata");
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [preferences, setPreferences] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("payleak-notification-preferences")) || { payments: true, invoices: true, insights: false };
    } catch (error) {
      console.error("Could not load notification preferences.", error);
      return { payments: true, invoices: true, insights: false };
    }
  });

  const save = () => {
    localStorage.setItem("payleak-currency", currency);
    localStorage.setItem("payleak-timezone", timezone);
    toast.success("Preferences saved for this browser.");
  };

  const saveProfile = async () => {
    if (!name.trim() || !email.includes("@")) {
      toast.error("Enter a name and a valid email address.");
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({ name: name.trim(), email });
      toast.success("Profile saved.");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Could not save your profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Could not end your server session. Please try again.");
      return;
    }
    navigate("/login", { replace: true });
  };

  return (
    <div className="page-enter settings-page">
      <PageHeader eyebrow="PREFERENCES" title="Settings" description="Manage your profile, connected account, and workspace preferences." />
      <div className="settings-layout">
        <nav className="settings-nav"><a className="active" href="#profile"><UserRound size={16} /> Profile</a><a href="#preferences"><Bell size={16} /> Preferences</a><a href="#connections"><WalletCards size={16} /> Connections</a><a href="#security"><ShieldCheck size={16} /> Security</a></nav>
        <div className="settings-content">
          <Panel title="Profile" subtitle="Your PayLeak workspace identity" className="settings-panel">
            <div className="settings-section" id="profile"><div className="settings-avatar">{user?.name?.trim().slice(0, 1).toUpperCase() || "?"}</div><div className="profile-edit-fields"><label className="field-label">Full name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label></div><button className="button secondary small-button" onClick={saveProfile} disabled={savingProfile}>{savingProfile ? "Saving…" : "Save profile"}</button></div>
          </Panel>
          <Panel title="Preferences" subtitle="Customize your dashboard defaults" className="settings-panel">
            <div className="settings-preferences" id="preferences"><label className="field-label">Preferred currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{["USD", "EUR", "GBP", "INR"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Time zone<select value={timezone} onChange={(event) => setTimezone(event.target.value)}>{["Asia/Kolkata", "UTC", "America/New_York", "Europe/London"].map((item) => <option key={item}>{item}</option>)}</select></label><button className="button primary" onClick={save}><Check size={15} /> Save preferences</button></div>
            <div className="settings-divider" /><div className="notification-preferences"><b>Notification preferences</b><small>These display preferences are saved in this browser.</small>{Object.entries({ payments: "Payment updates", invoices: "Invoice reminders", insights: "AI recommendations" }).map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => { const next = { ...preferences, [key]: event.target.checked }; localStorage.setItem("payleak-notification-preferences", JSON.stringify(next)); setPreferences(next); }} /><i /></label>)}</div>
          </Panel>
          <Panel title="Connected accounts" subtitle="Manage payment account access" className="settings-panel">
            <div className="connection-settings" id="connections"><span className="paypal-mark small">P</span><div><b>{paypal?.connected ? `PayPal ${paypal.environment === "sandbox" ? "Sandbox " : ""}Connected` : paypal ? "PayPal not connected" : "PayPal status unavailable"}</b><small>{paypalError ? "Shared integration status unavailable" : "Shared across authenticated PayLeak users"}</small></div><div className="connection-buttons"><Link className="button primary small-button" to="/connect-paypal"><Link2 size={14} /> PayPal Integration</Link><Link className="button secondary small-button" to="/paypal/sandbox-checkout"><WalletCards size={14} /> Sandbox test</Link></div></div>
          </Panel>
          <Panel title="Security" subtitle="Access and session controls" className="settings-panel">
            <div className="security-row" id="security"><span className="settings-row-icon"><KeyRound size={17} /></span><div><b>Password</b><small>Password changes and recovery are not available yet.</small></div><button className="button secondary small-button" disabled>Unavailable</button></div>
            <div className="security-row"><span className="settings-row-icon"><ShieldCheck size={17} /></span><div><b>Session security</b><small>Authentication uses a server-verified, HTTP-only session cookie.</small></div><span className="text-green">Enabled</span></div>
          </Panel>
          <Panel title="Session" subtitle="End your authenticated session" className="settings-panel">
            <div className="security-row"><span className="settings-row-icon"><LogOut size={17} /></span><div><b>Log out</b><small>Clear the server-issued session cookie.</small></div><button className="button danger-outline small-button" onClick={signOut}>Log out</button></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
