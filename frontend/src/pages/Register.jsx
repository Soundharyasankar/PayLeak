import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BarChart3, Check, ShieldCheck, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext.jsx";

export default function Register() {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password });
      toast.success("Your PayLeak account is ready.");
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Could not create your account. Please try again.");
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
          <p>Create a secure account for your financial records and Sandbox tests.</p>
          <div className="login-proof"><span><Check size={15} /> Your own secure account</span><span><Check size={15} /> Passwords are protected</span><span><Check size={15} /> You control connections</span></div>
        </div>
        <div className="login-panel-foot">Built for independent work across borders <span>© 2025 PayLeak</span></div>
      </section>
      <section className="login-form-panel">
        <div className="login-mobile-brand"><span className="brand-mark"><BarChart3 size={20} /></span>pay<span>leak</span></div>
        <form className="login-card" onSubmit={submit}>
          <div className="eyebrow">CREATE YOUR ACCOUNT</div>
          <h2>Join PayLeak</h2>
          <p className="muted">Use your email and a unique password.</p>
          <label className="field-label">Full name<input autoComplete="name" required maxLength={120} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Your name" /></label>
          <label className="field-label">Email address<input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="you@company.com" /></label>
          <label className="field-label">Password<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={form.password} onChange={(event) => update("password", event.target.value)} placeholder="At least 10 characters" /></label>
          <label className="field-label">Confirm password<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} placeholder="Re-enter your password" /></label>
          <button className="button primary full" type="submit" disabled={loading}>{loading ? <span className="spinner" /> : <>Create account <ArrowRight size={17} /></>}</button>
          <p className="signup-copy">Already registered? <Link className="text-button" to="/login">Sign in</Link></p>
          <div className="secure-note"><ShieldCheck size={16} /> Passwords are hashed before database storage</div>
        </form>
      </section>
    </div>
  );
}
