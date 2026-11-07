import { useState } from "react";
import { Bell, Check, KeyRound, Link2, LogOut, RefreshCw, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Panel from "../components/Panel.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useAppData } from "../context/AppContext.jsx";

export default function Settings() {
  const { user, paypal, disconnect, logout, updateProfile } = useAuth();
  const { resetDemo } = useAppData();
  const navigate = useNavigate();
  const [currency, setCurrency] = useState(localStorage.getItem("payleak-currency") || "USD");
  const [timezone, setTimezone] = useState(localStorage.getItem("payleak-timezone") || "Asia/Kolkata");
  const [name, setName] = useState(user?.name || "Alex Morgan");
  const [email, setEmail] = useState(user?.email || "alex.morgan@example.test");
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

  const reset = () => {
    if (!window.confirm("Reset your local sample invoices and notifications to the original demo data?")) return;
    resetDemo();
    toast.success("Demo data has been reset.");
  };

  const signOut = () => {
    if (!window.confirm("Log out and disconnect the demo account?")) return;
    logout();
    navigate("/login");
  };

  return (
    <div className="page-enter settings-page">
      <PageHeader eyebrow="PREFERENCES" title="Settings" description="Manage your profile, connected account, and demo experience." />
      <div className="settings-layout">
        <nav className="settings-nav"><a className="active" href="#profile"><UserRound size={16} /> Profile</a><a href="#preferences"><Bell size={16} /> Preferences</a><a href="#connections"><WalletCards size={16} /> Connections</a><a href="#security"><ShieldCheck size={16} /> Security</a></nav>
        <div className="settings-content">
          <Panel title="Profile" subtitle="Your PayLeak workspace identity" className="settings-panel" >
            <div className="settings-section" id="profile"><div className="settings-avatar">AM</div><div className="profile-edit-fields"><label className="field-label">Full name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label></div><button className="button secondary small-button" onClick={() => { if (!name.trim() || !email.includes("@")) return toast.error("Enter a name and a valid email address."); updateProfile({ name: name.trim(), email }); toast.success("Profile saved in this browser."); }}>Save profile</button></div>
          </Panel>
          <Panel title="Preferences" subtitle="Customize your dashboard defaults" className="settings-panel">
            <div className="settings-preferences" id="preferences"><label className="field-label">Preferred currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{["USD", "EUR", "GBP", "INR"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Time zone<select value={timezone} onChange={(event) => setTimezone(event.target.value)}>{["Asia/Kolkata", "UTC", "America/New_York", "Europe/London"].map((item) => <option key={item}>{item}</option>)}</select></label><button className="button primary" onClick={save}><Check size={15} /> Save preferences</button></div>
            <div className="settings-divider" /><div className="notification-preferences"><b>Notification preferences</b><small>Control which demo alerts are shown in your workspace.</small>{Object.entries({ payments: "Payment updates", invoices: "Invoice reminders", insights: "AI recommendations" }).map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => { const next = { ...preferences, [key]: event.target.checked }; localStorage.setItem("payleak-notification-preferences", JSON.stringify(next)); setPreferences(next); }} /><i /></label>)}</div>
          </Panel>
          <Panel title="Connected accounts" subtitle="Manage payment account access" className="settings-panel">
            <div className="connection-settings" id="connections"><span className="paypal-mark small">P</span><div><b>PayPal {paypal ? "Sandbox connected" : "not connected"}</b><small>{paypal?.email || "Connect a sandbox account to continue exploring."}</small><small className="connection-status"><i /> {paypal ? "Demo connection active" : "Not connected"}</small></div><div className="connection-buttons">{paypal ? <button className="button secondary small-button" onClick={() => { if (window.confirm("Disconnect the PayPal demo account?")) { disconnect(); navigate("/connect-paypal"); } }}>Disconnect</button> : <Link className="button primary small-button" to="/connect-paypal"><Link2 size={14} /> Connect</Link>}</div></div>
          </Panel>
          <Panel title="Security" subtitle="Access and session controls" className="settings-panel">
            <div className="security-row" id="security"><span className="settings-row-icon"><KeyRound size={17} /></span><div><b>Password</b><small>Password management is not enabled in the demo prototype.</small></div><button className="button secondary small-button" onClick={() => toast("Password changes require the production authentication service.")}>Manage</button></div>
            <div className="security-row"><span className="settings-row-icon"><ShieldCheck size={17} /></span><div><b>Demo data privacy</b><small>All records shown are fictional and stored only in this browser.</small></div><span className="text-green">Protected</span></div>
          </Panel>
          <Panel title="Demo workspace" subtitle="Reset local sample data or end your session" className="settings-panel demo-settings">
            <div className="security-row"><span className="settings-row-icon"><RefreshCw size={17} /></span><div><b>Reset demo data</b><small>Restore sample invoices and notifications. Your profile remains signed in.</small></div><button className="button secondary small-button" onClick={reset}>Reset data</button></div>
            <div className="security-row"><span className="settings-row-icon"><LogOut size={17} /></span><div><b>Log out</b><small>End the local demo session and disconnect the sandbox simulation.</small></div><button className="button danger-outline small-button" onClick={signOut}>Log out</button></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
