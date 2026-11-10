import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Activity, Bell, Bot, ChevronDown, CircleHelp, FileText, LayoutDashboard, LogOut, Menu, ReceiptText, Search, Settings, WalletCards, X } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useAppData } from "../context/AppContext.jsx";
import toast from "react-hot-toast";

const navigation = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Transactions", to: "/transactions", icon: ReceiptText },
  { label: "Invoices", to: "/invoices", icon: FileText },
  { label: "Money leak analysis", to: "/leak-analysis", icon: Activity },
  { label: "AI assistant", to: "/ai-assistant", icon: Bot },
  { label: "Notifications", to: "/notifications", icon: Bell, count: true },
];

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { user, logout, paypal } = useAuth();
  const { notifications, loading, error, refresh } = useAppData();
  const navigate = useNavigate();
  const unread = notifications.filter((item) => item.unread).length;

  const initials = user?.name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

  const signOut = async () => {
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (requestError) {
      console.error("Could not clear the server session.", requestError);
      toast.error("Session cleared in this page, but the server could not confirm logout.");
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><Activity size={21} strokeWidth={2.7} /></div>
          <span>pay<span className="brand-accent">leak</span></span>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="workspace-switch"><span className="workspace-avatar">{initials.slice(0, 1)}</span><span><b>{user?.name}</b><small>{user?.email}</small></span><ChevronDown size={15} /></div>
        <span className="nav-caption">WORKSPACE</span>
        <nav className="side-nav">
          {navigation.map(({ label, to, icon: Icon, count }) => (
            <NavLink key={to} to={to} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              <Icon size={18} /><span>{label}</span>{count && unread > 0 && <span className="nav-count">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-connect">
          <div className="connect-mini-icon"><WalletCards size={18} /></div>
          <div><b>PayPal {paypal?.canSync ? "sync authorized" : paypal?.applicationCredentialsConfigured ? "app configured" : "not authorized"}</b><small>{paypal?.environment ? `${paypal.environment} · ${paypal.ownerBinding?.replaceAll("_", " ") || "owner not configured"}` : "Merchant access requires verification"}</small></div>
          <span className={`connection-dot ${paypal?.connected ? "connected" : ""}`} />
        </div>
        <div className="sidebar-bottom">
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Settings size={18} /><span>Settings</span></NavLink>
          <button className="nav-link" onClick={() => navigate("/settings")}><CircleHelp size={18} /><span>Help center</span></button>
          <div className="sidebar-user">
            <div className="user-avatar">{initials}</div>
            <div className="user-details"><b>{user?.name}</b><small>{user?.email}</small></div>
            <button className="icon-button" onClick={signOut} title="Log out" aria-label="Log out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <div className="global-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && navigate(`/invoices?search=${encodeURIComponent(search)}`)} placeholder="Search invoices..." /></div>
          <div className="topbar-actions">
            <button className="icon-button notification-button" onClick={() => navigate("/notifications")} aria-label={`${unread} unread notifications`}><Bell size={19} />{unread > 0 && <i />}</button>
            <div className="profile-wrap">
              <button className="profile-trigger" onClick={() => setProfileOpen(!profileOpen)}><span className="user-avatar small">{initials}</span><ChevronDown size={14} /></button>
              {profileOpen && <div className="profile-menu"><button onClick={() => { navigate("/settings"); setProfileOpen(false); }}><Settings size={15} /> Settings</button><button onClick={signOut}><LogOut size={15} /> Log out</button></div>}
            </div>
          </div>
        </header>
        <main className="content-area">
          {loading ? <div className="page-loading"><span className="spinner" /> Loading account data…</div> : error ? <div className="panel empty-state"><b>Could not load your account data</b><span>{error}</span><button className="button secondary" onClick={() => void refresh()}>Retry</button></div> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
