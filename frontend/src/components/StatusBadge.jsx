export default function StatusBadge({ children }) {
  const tone = String(children).toLowerCase().replace(/\s+/g, "-");
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
