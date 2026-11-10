import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export default function StatCard({ label, value, note, change, tone = "purple", icon: Icon }) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        {Icon && <span className={`stat-icon ${tone}`}><Icon size={18} /></span>}
      </div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-foot">
        {change && <span className={`change ${change.startsWith("-") ? "negative" : "positive"}`}>{change.startsWith("-") ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{change}</span>}
        <span>{note}</span>
      </div>
    </article>
  );
}
