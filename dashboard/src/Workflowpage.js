import React, { useEffect, useRef, useState } from "react";
import "./Workflowpage.css";

const CARDS = [
  {
    icon: "◈",
    title: "AI LOG ANALYSIS",
    desc: "Cluster failures & generate Groq AI root-cause reports instantly.",
    bar: 82,
    delay: "0s",
  },
  {
    icon: "⬡",
    title: "CANARY DEPLOYMENT",
    desc: "Shift traffic gradually between stable and experimental builds.",
    bar: 65,
    delay: "0.1s",
  },
  {
    icon: "↺",
    title: "AUTO ROLLBACK",
    desc: "Instant rollback when error thresholds are crossed.",
    bar: 90,
    delay: "0.2s",
  },
  {
    icon: "◎",
    title: "REAL-TIME TIMELINE",
    desc: "Visualize full request history with adaptive time buckets.",
    bar: 75,
    delay: "0.1s",
  },
  {
    icon: "◈",
    title: "FAILURE CLUSTERING",
    desc: "Groups repeated backend errors by fingerprint & path.",
    bar: 58,
    delay: "0.2s",
  },
  {
    icon: "⬆",
    title: "LOG UPLOAD ENGINE",
    desc: "Paste or upload logs for instant analysis.",
    bar: 88,
    delay: "0.3s",
  },
];

const SOLO_CARD = {
  icon: "⬡",
  title: "AI CODE PATCH SOLVER",
  desc: "Generates fix → tests in sandbox → deploys after approval.",
  bar: 95,
};

const STATUSES = [
  "SYS: ONLINE · UPLINK: STABLE · LATENCY: 2ms",
  "GROQ API: READY · ERROR RATE: 0.2%",
  "DEPLOY: OK · PATCHES: APPROVED",
  "CANARY: 10% · LOGS: FLOWING",
];

function Card({ card, onHover, onLeave }) {
  return (
    <div
      className={`wf-card ${card.solo ? "wf-card--solo" : ""}`}
      style={{ "--bw": card.bar + "%", "--dl": card.delay }}
      onMouseEnter={(e) => onHover?.(card, e)}
      onMouseMove={(e) => onHover?.(card, e)}
      onMouseLeave={onLeave}
    >
      <div className="wf-face">
        <div className="wf-icon">{card.icon}</div>
        <div>
          <div className="wf-title">{card.title}</div>
          <div className="wf-desc">{card.desc}</div>
        </div>

        <div className="wf-bar">
          <div className="wf-bar-fill" />
        </div>
      </div>
    </div>
  );
}

export default function WorkflowPage({ onEnterDashboard }) {
  const [status, setStatus] = useState(STATUSES[0]);
  const [tip, setTip] = useState(null);
  const sceneRef = useRef(null);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % STATUSES.length;
      setStatus(STATUSES[i]);
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const handleHover = (card, e) => {
    const rect = sceneRef.current?.getBoundingClientRect();
    if (!rect) return;

    let x = e.clientX - rect.left + 12;
    let y = e.clientY - rect.top + 12;

    if (x + 200 > rect.width) x = e.clientX - rect.left - 210;

    setTip({ title: card.title, desc: card.desc, x, y });
  };

  return (
    <div className="wf-scene" ref={sceneRef}>
     

    

      <div className="wf-grid">
        {CARDS.map((c) => (
          <Card key={c.title} card={c} onHover={handleHover} onLeave={() => setTip(null)} />
        ))}

        <Card card={{ ...SOLO_CARD, solo: true }} onHover={handleHover} onLeave={() => setTip(null)} />
      </div>

      {tip && (
        <div className="wf-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="wf-tip-title">{tip.title}</div>
          {tip.desc}
        </div>
      )}

      <div className="wf-status">{status}</div>
    </div>
  );
}