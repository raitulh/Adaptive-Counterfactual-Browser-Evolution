import React from "react";
import { CheckCircle, TrendingUp, ShieldAlert, Cpu } from "lucide-react";

export const ProofBar: React.FC = () => {
  const stats = [
    {
      value: "100.0%",
      label: "Transfer Success",
      desc: "Zero-shot transfer across brand new websites",
      icon: <CheckCircle className="w-4 h-4 text-emerald-400" />,
    },
    {
      value: "0.0%",
      label: "Regression Rate",
      desc: "Held-out regression suite completely protected",
      icon: <TrendingUp className="w-4 h-4 text-sky-400" />,
    },
    {
      value: "2.05x",
      label: "Token Cost Ratio",
      desc: "Statistical budget gating stops infinite burn",
      icon: <Cpu className="w-4 h-4 text-amber-400" />,
    },
    {
      value: "$0",
      label: "Retraining Cost",
      desc: "Improves purely via procedural memory & ranking",
      icon: <ShieldAlert className="w-4 h-4 text-purple-400" />,
    },
  ];

  return (
    <section className="border-y border-white/[0.08] bg-[#07090d]/60 backdrop-blur-md py-10 px-6">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map((st, i) => (
          <div key={i} className="flex flex-col space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
              {st.icon}
              <span>{st.label}</span>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold font-mono text-white tracking-tight">
              {st.value}
            </div>
            <div className="text-[11px] text-gray-500">{st.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
};
