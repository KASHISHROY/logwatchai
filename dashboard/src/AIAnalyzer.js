import React, { useState } from 'react';
import './AIAnalyzer.css';

const AIAnalyzer = ({ logs, stats }) => {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  const analyzeLogs = async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await fetch('https://logwatch-proxy.onrender.com/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setAnalysis(data.result);
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const parseAnalysis = (text) => {
    if (!text) return null;
    const errors = [];
    for (let i = 1; i <= 3; i++) {
      const obj = {};
      ['CODE','BACKEND','FREQUENCY','PERCENTAGE','SEVERITY','CAUSE','FIX'].forEach(key => {
        const m = text.match(new RegExp(`ERROR_${i}_${key}:\\s*(.+?)(?=ERROR_|OVERALL_|$)`, 's'));
        obj[key.toLowerCase()] = m ? m[1].trim() : null;
      });
      if (obj.code && obj.code !== 'null' && obj.code !== '') errors.push(obj);
    }

    const overall     = text.match(/OVERALL_HEALTH:\s*(.+?)(?=RECOMMENDATION:|$)/s);
    const recommend   = text.match(/RECOMMENDATION:\s*(.+?)(?=RISK_LEVEL:|$)/s);
    const risk        = text.match(/RISK_LEVEL:\s*(.+?)$/m);

    return {
      errors,
      overallHealth:  overall   ? overall[1].trim()   : 'Unknown',
      recommendation: recommend ? recommend[1].trim()  : '',
      riskLevel:      risk      ? risk[1].trim()       : 'Unknown',
    };
  };

  const severityColor = (sev) => {
    const s = (sev || '').toUpperCase();
    if (s === 'CRITICAL') return '#ff4444';
    if (s === 'HIGH')     return '#f59e0b';
    if (s === 'MEDIUM')   return '#22d3ee';
    return '#00ff88';
  };

  const analyzed = parseAnalysis(analysis);

  return (
    <section className="ai-analyzer-section">
      <div className="ai-header">
        <h2>// AI Error Analyzer</h2>
        <span className="section-tag">AI</span>
      </div>

      <button className="analyze-btn" onClick={analyzeLogs} disabled={loading}>
        {loading ? '⟳  Analyzing...' : '⬡  Run AI Analysis'}
      </button>

      {error && <div className="error-message">{error}</div>}

      {analyzed && analyzed.errors.length > 0 && (
        <div className="analysis-result">

          {/* ── Top 3 Errors ── */}
          <div className="top-3-errors">
            {analyzed.errors.map((err, idx) => (
              <div
                key={idx}
                className="error-card"
                style={{ borderLeftColor: severityColor(err.severity) }}
              >
                <div className="error-header">
                  <div className="error-number">0{idx + 1}</div>
                  <div className="error-code-section">
                    <h3>ERROR {err.code}</h3>
                    <span className="error-backend">{err.backend}</span>
                  </div>
                  <div className="error-severity" style={{ color: severityColor(err.severity) }}>
                    <span>{err.severity?.toUpperCase() || 'UNKNOWN'}</span>
                  </div>
                </div>

                <div className="error-metrics">
                  <div className="metric">
                    <strong>Frequency</strong>
                    {err.frequency || '—'}
                  </div>
                  <div className="metric">
                    <strong>Impact</strong>
                    {err.percentage || '—'}
                  </div>
                </div>

                <div className="error-explanation">
                  <strong>What's Wrong</strong>
                  <p>{err.cause || 'Unknown error'}</p>
                </div>

                <div className="error-fix">
                  <strong>→ How to Fix</strong>
                  <p>{err.fix || 'Review error logs'}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Overall Assessment ── */}
          {analyzed.recommendation && (
            <div className="ai-assessment">
              <h3>// Overall Assessment</h3>

              <div className="assessment-item">
                <strong>System Health</strong>
                <span className={`health-status ${analyzed.overallHealth.toLowerCase()}`}>
                  {analyzed.overallHealth}
                </span>
              </div>

              <div className="assessment-item">
                <strong>Recommendation</strong>
                <p>{analyzed.recommendation}</p>
              </div>

              <div className="assessment-item">
                <strong>Risk Level</strong>
                <span className={`risk-level ${analyzed.riskLevel.toLowerCase()}`}>
                  {analyzed.riskLevel}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {!analysis && !loading && (
        <div className="analysis-placeholder">
          ◈ &nbsp; Click button to analyze errors with AI
        </div>
      )}
    </section>
  );
};

export default AIAnalyzer;