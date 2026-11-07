import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BarChart3, Check, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const [email, setEmail] = useState("alex.morgan@example.test");
  const [password, setPassword] = useState("payleakdemo");
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const submit = (event) => {
    event.preventDefault();
    if (!email.includes("@") || password.length < 6) {
      toast.error("Enter a valid email and a password of at least 6 characters.");
      return;
    }
    login(email);
    toast.success("Welcome to the PayLeak demo.");
    navigate("/connect-paypal");
  };

  return (
    <div className="login-screen">
      <section className="login-brand-panel">
        <div className="login-brand"><span className="brand-mark"><BarChart3 size={21} /></span>pay<span>leak</span></div>
        <div className="login-pitch">
          <div className="eyebrow light"><Sparkles size={14} /> FINANCIAL CLARITY, FINALLY</div>
          <h1>Take Control of Your International Payments.</h1>
          <p>Discover hidden fees. Optimize currency conversion. Keep more of what you earn.</p>
          <div className="login-proof"><span><Check size={15} /> Understand every fee</span><span><Check size={15} /> Compare smarter routes</span><span><Check size={15} /> Make informed decisions</span></div>
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
          <div className="login-options"><label className="check-label"><input type="checkbox" defaultChecked /> Remember me</label><button type="button" className="text-button" onClick={() => toast("Password recovery is not enabled in the demo.")}>Forgot password?</button></div>
          <button className="button primary full" type="submit">Sign in <ArrowRight size={17} /></button>
          <div className="or-divider"><span>or</span></div>
          <button className="button secondary full" type="button" onClick={() => { login(email); navigate("/connect-paypal"); }}>Explore with demo account</button>
          <p className="signup-copy">New to PayLeak? <button className="text-button" type="button" onClick={() => toast("Sign-up is not enabled in this prototype.")}>Create an account</button></p>
          <div className="secure-note"><ShieldCheck size={16} /> Secure demo · No real payment data</div>
        </form>
      </section>
    </div>
  );
}
