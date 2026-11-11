import PageHeader from "../components/PageHeader.jsx";
import PaypalLeakCalculator from "../components/PaypalLeakCalculator.jsx";

export default function LeakAnalysis() {
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="ANALYTICS"
        title="Money Leak Analysis"
        description="Estimate PayPal's fee and INR conversion impact with every step and assumption visible."
      />
      <PaypalLeakCalculator />
    </div>
  );
}
