import React, { useState, useEffect } from 'react';
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, ResponsiveContainer
} from 'recharts';
import './Analytics.css';

const Analytics = ({ logs }) => {
  const [errorDistribution, setErrorDistribution] = useState([]);
  const [timeline, setTimeline]                   = useState([]);
  const [comparison, setComparison]               = useState([]);
  const [severity, setSeverity]                   = useState([]);

  useEffect(() => {
    if (!logs || logs.length === 0) return;

    // ── 1. Error Distribution ───────────────────────────────────────────
    const errorCounts = {};
    logs.forEach(log => {
      const code = log.statusCode || log.status;
      if (code >= 400) {
        errorCounts[code] = (errorCounts[code] || 0) + 1;
      }
    });

    setErrorDistribution(
      Object.entries(errorCounts)
        .map(([code, count]) => ({ name: `${code}`, value: count }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
    );

    // ── 2. Timeline — adaptive bucketing based on actual log span ───────
    const timestamps = logs
      .map(l => new Date(l.timestamp).getTime())
      .filter(t => !isNaN(t));

    if (timestamps.length > 0) {
      const minTime  = Math.min(...timestamps);
      const maxTime  = Math.max(...timestamps);
      const spanMs   = maxTime - minTime;

      // Choose bucket size based on span
      let bucketMs;
      if      (spanMs <= 10 * 60 * 1000)  bucketMs = 60 * 1000;        // 1-min buckets up to 10 min
      else if (spanMs <= 60 * 60 * 1000)  bucketMs = 5 * 60 * 1000;    // 5-min buckets up to 1 hr
      else if (spanMs <= 6 * 60 * 60 * 1000) bucketMs = 30 * 60 * 1000; // 30-min up to 6 hr
      else                                 bucketMs = 60 * 60 * 1000;   // 1-hr buckets beyond

      // Cap at 12 buckets max
      const rawCount  = Math.ceil(spanMs / bucketMs);
      const numBuckets = Math.min(rawCount + 1, 12);
      // Recalculate bucketMs so we always cover full span in ≤12 buckets
      const finalBucketMs = numBuckets > 1 ? Math.ceil(spanMs / (numBuckets - 1)) : bucketMs;

      const timelineData = [];
      for (let i = 0; i < numBuckets; i++) {
        const bucketStart = minTime + i * finalBucketMs;
        const bucketEnd   = bucketStart + finalBucketMs;

        const bucket = logs.filter(l => {
          const t = new Date(l.timestamp).getTime();
          return t >= bucketStart && t < bucketEnd;
        });

        const errors = bucket.filter(l => (l.statusCode || l.status || 200) >= 400).length;
        const d      = new Date(bucketStart);

        let label;
        if (spanMs <= 24 * 60 * 60 * 1000) {
          label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
          label = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
                + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        timelineData.push({
          time:      label,
          errorRate: bucket.length ? Math.round((errors / bucket.length) * 100) : 0,
          requests:  bucket.length,
        });
      }

      setTimeline(timelineData);
    }

    // ── 3. Stable vs Canary ─────────────────────────────────────────────
    const stableErr   = logs.filter(l => (l.statusCode || l.status || 200) >= 400 && l.target?.includes('5001')).length;
    const stableTotal = logs.filter(l => l.target?.includes('5001')).length;

    const canaryErr   = logs.filter(l => (l.statusCode || l.status || 200) >= 400 && l.target?.includes('5002')).length;
    const canaryTotal = logs.filter(l => l.target?.includes('5002')).length;

    setComparison([
      {
        name:      'Stable',
        errorRate: stableTotal ? Math.round((stableErr / stableTotal) * 100) : 0,
        requests:  stableTotal,
      },
      {
        name:      'Canary',
        errorRate: canaryTotal ? Math.round((canaryErr / canaryTotal) * 100) : 0,
        requests:  canaryTotal,
      },
    ]);

    // ── 4. Severity ─────────────────────────────────────────────────────
    const sv = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

    logs.forEach(l => {
      const code = l.statusCode || l.status || 200;
      if (code >= 500)                    sv.CRITICAL++;
      else if ([429, 408].includes(code)) sv.HIGH++;
      else if (code >= 400)               sv.MEDIUM++;
      else                                sv.LOW++;
    });

    setSeverity(
      [
        { name: 'Critical', value: sv.CRITICAL, color: '#ff4444' },
        { name: 'High',     value: sv.HIGH,     color: '#f59e0b' },
        { name: 'Medium',   value: sv.MEDIUM,   color: '#22d3ee' },
        { name: 'Low',      value: sv.LOW,       color: '#00ff88' },
      ].filter(i => i.value > 0)
    );

  }, [logs]);

  const COLORS = ['#ff4444', '#f59e0b', '#22d3ee', '#a78bfa', '#00ff88'];

  const TooltipBox = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="tooltip-box">
        <div className="tooltip-title">{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color }}>
            {p.name}: <b>{p.value}</b>
          </div>
        ))}
      </div>
    );
  };

  // ✅ readable tick color on dark bg
  const tickStyle = { fill: '#6ab8a8', fontSize: 10 };

  return (
    <section className="analytics-section">

      <div className="analytics-header">
        <h2>// Analytics &amp; Insights</h2>
        <span className="section-tag">LIVE</span>
      </div>

      <div className="charts-grid">

        <div className="chart-card" data-depth="1">
          <h3>Error Distribution</h3>
          {errorDistribution.length === 0 ? (
            <div className="chart-empty">No errors yet ✅</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={errorDistribution} dataKey="value" cx="50%" cy="50%" outerRadius={80}>
                  {errorDistribution.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<TooltipBox />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card" data-depth="1">
          <h3>Error Rate Timeline</h3>
          {timeline.length === 0 ? (
            <div className="chart-empty">Waiting for logs...</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timeline}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#00ff88" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#00ff88" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time"      tick={tickStyle} />
                <YAxis tick={tickStyle}    unit="%" domain={[0, 100]} />
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,255,136,0.08)" />
                <Tooltip content={<TooltipBox />} />
                <Area type="monotone" dataKey="errorRate" name="Error Rate %" stroke="#00ff88" fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card" data-depth="1">
          <h3>Stable vs Canary Error Rate</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={comparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,255,136,0.08)" />
              <XAxis dataKey="name" tick={tickStyle} />
              <YAxis tick={tickStyle} unit="%" domain={[0, 100]} />
              <Tooltip content={<TooltipBox />} />
              <Bar dataKey="errorRate" name="Error Rate %">
                {comparison.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#00ff88' : '#f59e0b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card" data-depth="1">
          <h3>Severity Breakdown</h3>
          {severity.length === 0 ? (
            <div className="chart-empty">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={severity} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={75}>
                  {severity.map((s, i) => (
                    <Cell key={i} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip content={<TooltipBox />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </section>
  );
};

export default Analytics;