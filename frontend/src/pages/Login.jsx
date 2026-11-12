import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, Check, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      await login({ email, password });
    } catch (error) {
      toast.error(error.response?.data?.error?.message || error.message || "Could not sign in. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <section className="login-brand-panel">
        <div className="login-brand"><span className="brand-mark"><BarChart3 size={21} /></span>pay<span>leak</span></div>
        <div className="login-pitch">
          <div className="eyebrow light"><Sparkles size={14} /> FINANCIAL CLARITY, FINALLY</div>
          <h1>Take Control of Your International Payments.</h1>
          <p>Review your payment records and understand the fees PayPal reports.</p>
          <div className="login-proof"><span><Check size={15} /> Review stored transactions</span><span><Check size={15} /> See reported fees</span><span><Check size={15} /> Make informed decisions</span></div>
        </div>
        <div className="login-panel-foot">Built for independent work across borders <span>© 2025 PayLeak</span></div>
      </section>
      <section className="login-form-panel">
        <div className="login-mobile-brand"><span className="brand-mark"><BarChart3 size={20} /></span>pay<span>leak</span></div>
        <form className="login-card" onSubmit={submit}>
          <div className="eyebrow">WELCOME BACK</div>
          <h2>Sign in to PayLeak</h2>
          <p className="muted">Your payment clarity is one step away.</p>
          <label className="field-label">Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
          <label className="field-label">Password<span className="password-field"><input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /><button type="button" className="icon-button" aria-label="Show password" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          <button className="button primary full" type="submit" disabled={loading}>{loading ? <span className="spinner" /> : <>Sign in <ArrowRight size={17} /></>}</button>
          <p className="signup-copy">New to PayLeak? <Link className="text-button" to="/register">Create an account</Link></p>
          <div className="secure-note"><ShieldCheck size={16} /> Secure sign-in · Your session is protected</div>
        </form>
      </section>
    </div>
  );
}
