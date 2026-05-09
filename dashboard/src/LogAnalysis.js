import React, { useState, useRef } from 'react';
import './LogAnalysis.css';

const isLocalDashboard =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL ||
  (isLocalDashboard ? 'http://127.0.0.1:4000' : 'https://logwatch-proxy.onrender.com');

function clusterLogs(logs) {
  const clusters = {};
  logs.forEach(log => {
    if (log.statusCode < 400) return;
    const msg = typeof log.responseBody === 'string'
      ? log.responseBody
      : log.responseBody?.message || log.responseBody?.error || 'Unknown error';
    const key = `${log.statusCode}::${msg.substring(0, 40)}`;
    if (!clusters[key]) {
      clusters[key] = { statusCode: log.statusCode, message: msg, count: 0, firstSeen: log.timestamp, lastSeen: log.timestamp, backends: new Set(), paths: new Set() };
    }
    clusters[key].count++;
    clusters[key].lastSeen = log.timestamp;
    if (log.target?.includes('logwatch-stable')) clusters[key].backends.add('Stable');
    else clusters[key].backends.add('Test');
    clusters[key].paths.add(log.path || '/api');
  });
  return Object.values(clusters)
    .map(c => ({ ...c, backends: [...c.backends], paths: [...c.paths] }))
    .sort((a, b) => b.count - a.count);
}

function buildTimeline(logs) {
  if (logs.length === 0) return [];
  const timestamps = logs.map(l => new Date(l.timestamp).getTime()).filter(t => !isNaN(t));
  if (timestamps.length === 0) return [];
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const totalSpan = maxTime - minTime;
  let bucketMs, bucketCount;
  if (totalSpan <= 10 * 60 * 1000) { bucketMs = 60 * 1000; bucketCount = Math.max(Math.ceil(totalSpan / bucketMs), 2); }
  else if (totalSpan <= 60 * 60 * 1000) { bucketMs = 5 * 60 * 1000; bucketCount = Math.ceil(totalSpan / bucketMs); }
  else if (totalSpan <= 6 * 60 * 60 * 1000) { bucketMs = 30 * 60 * 1000; bucketCount = Math.ceil(totalSpan / bucketMs); }
  else if (totalSpan <= 24 * 60 * 60 * 1000) { bucketMs = 60 * 60 * 1000; bucketCount = Math.ceil(totalSpan / bucketMs); }
  else { bucketMs = 6 * 60 * 60 * 1000; bucketCount = Math.ceil(totalSpan / bucketMs); }
  if (bucketCount > 20) { bucketCount = 20; bucketMs = Math.ceil(totalSpan / 20); }
  const buckets = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = minTime + i * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    const inBucket = logs.filter(l => { const t = new Date(l.timestamp).getTime(); return t >= bucketStart && t < bucketEnd; });
    const d = new Date(bucketStart);
    let label;
    if (totalSpan <= 24 * 60 * 60 * 1000) { label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    else { label = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    buckets.push({ label, total: inBucket.length, errors: inBucket.filter(l => l.statusCode >= 400).length, errorRate: inBucket.length > 0 ? Math.round((inBucket.filter(l => l.statusCode >= 400).length / inBucket.length) * 100) : 0 });
  }
  return buckets;
}

function parseRawLogs(text) {
  const parsed = [];
  const lines = text.trim().split('\n');
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    try {
      const obj = JSON.parse(line);
      if (obj.statusCode || obj.status || obj.level) {
        parsed.push({ timestamp: obj.timestamp || obj.time || new Date().toISOString(), method: obj.method || 'GET', path: obj.path || obj.url || '/api', statusCode: parseInt(obj.statusCode || obj.status || (obj.level === 'error' ? 500 : 200)), duration: obj.duration || obj.responseTime || 0, target: obj.target || (obj.backend === 'stable' ? 'https://logwatch-stable.onrender.com' : 'https://logwatch-test.onrender.com'), ip: obj.ip || '127.0.0.1', responseBody: obj.responseBody || obj.message || obj.msg || 'parsed' });
        return;
      }
    } catch (_) {}
    const apacheMatch = line.match(/(\S+)\s+\S+\s+\S+\s+\[(.+?)\]\s+"(\w+)\s+(\S+)[^"]*"\s+(\d{3})\s+(\d+|-)/);
    if (apacheMatch) { parsed.push({ timestamp: new Date().toISOString(), method: apacheMatch[3], path: apacheMatch[4], statusCode: parseInt(apacheMatch[5]), duration: 0, target: 'https://logwatch-stable.onrender.com', ip: apacheMatch[1], responseBody: `Status ${apacheMatch[5]}` }); return; }
    const simpleMatch = line.match(/\[?(ERROR|WARN|INFO|SUCCESS)\]?\s+\[?(\d{3})\]?\s+(\w+)\s+(\S+)/i);
    if (simpleMatch) { parsed.push({ timestamp: new Date().toISOString(), method: simpleMatch[3], path: simpleMatch[4], statusCode: parseInt(simpleMatch[2]), duration: 0, target: 'https://logwatch-stable.onrender.com', ip: '127.0.0.1', responseBody: line }); }
  });
  return parsed;
}

const getSeverity = (code) => {
  if (code >= 500) return { label: 'CRITICAL', color: '#dc2626', bg: '#fef2f2' };
  if (code === 429 || code === 408) return { label: 'HIGH', color: '#ea580c', bg: '#fff7ed' };
  if (code >= 400) return { label: 'MEDIUM', color: '#f59e0b', bg: '#fffbeb' };
  return { label: 'LOW', color: '#10b981', bg: '#f0fdf4' };
};

const renderSummary = (text) => {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '• $1')
    .replace(/\n/g, '<br/>');
};

function spanLabel(logs) {
  const timestamps = logs.map(l => new Date(l.timestamp).getTime()).filter(t => !isNaN(t));
  if (timestamps.length === 0) return '';
  const span = Math.max(...timestamps) - Math.min(...timestamps);
  if (span < 60000)    return 'Last < 1 min';
  if (span < 3600000)  return `Last ${Math.round(span / 60000)} min`;
  if (span < 86400000) return `Last ${Math.round(span / 3600000)} hr`;
  return `Last ${Math.round(span / 86400000)} day(s)`;
}

const LogAnalysis = ({ logs: liveLogs = [] }) => {
  const [activeTab,  setActiveTab]  = useState('paste');
  const [pastedText, setPastedText] = useState('');
  const [parsedLogs, setParsedLogs] = useState([]);
  const [parseError, setParseError] = useState('');
  const [aiSummary,  setAiSummary]  = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiError,    setAiError]    = useState('');
  const fileRef = useRef(null);

  const workingLogs = activeTab === 'live' ? liveLogs : parsedLogs;
  const clusters    = clusterLogs(workingLogs);
  const timeline    = buildTimeline(workingLogs);
  const maxBar      = Math.max(...timeline.map(t => t.total), 1);
  const timeLabel   = spanLabel(workingLogs);
  const totalErrors = workingLogs.filter(l => l.statusCode >= 400).length;
  const errorRate   = workingLogs.length > 0 ? ((totalErrors / workingLogs.length) * 100).toFixed(1) : 0;

  const handleParse = (text) => {
    setParseError('');
    const result = parseRawLogs(text);
    if (result.length === 0) {
      setParseError('Could not parse any log entries. Try JSON lines format.');
    } else {
      setParsedLogs(result);
      setAiSummary('');
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { const text = ev.target.result; setPastedText(text); handleParse(text); };
    reader.readAsText(file);
  };

  const runAI = async () => {
    setAiLoading(true);
    setAiError('');
    setAiSummary('');
    if (workingLogs.length === 0) { setAiError('No logs to analyse.'); setAiLoading(false); return; }
    try {
      const response = await fetch(`${API_BASE_URL}/api/analyze-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: workingLogs }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (!data.result) throw new Error('Empty response from server');
      setAiSummary(data.result);
    } catch (err) {
      setAiError('AI analysis failed: ' + err.message);
      console.error('[LogAnalysis AI Error]', err);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <section className="log-analysis-section">
      <div className="la-header">
        <h2>🔬 Log Analysis Tool</h2>
        <p className="la-subtitle">Ingest logs → detect patterns → cluster failures → AI incident summary</p>
      </div>

      {activeTab === 'paste' && (
        <div className="la-input-panel">
          <div className="la-upload-row">
            <button className="la-upload-btn" onClick={() => fileRef.current.click()}>📁 Upload Log File</button>
            <span className="la-upload-hint">(.log, .txt, .json)</span>
            <input ref={fileRef} type="file" accept=".log,.txt,.json" style={{ display: 'none' }} onChange={handleFileUpload} />
          </div>
          <textarea
            className="la-textarea"
            placeholder={`Paste JSON log lines here, one per line. Example:\n{"timestamp":"2026-03-28T10:00:01Z","method":"GET","path":"/api","statusCode":500,"duration":45,"target":"https://logwatch-test.onrender.com","ip":"127.0.0.1","responseBody":"Database connection pool exhausted"}`}
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            rows={8}
          />
          <div className="la-parse-row">
            <button className="la-parse-btn" onClick={() => handleParse(pastedText)} disabled={!pastedText.trim()}>⚡ Parse Logs</button>
            {parsedLogs.length > 0 && <span className="la-parse-success">✅ {parsedLogs.length} entries parsed</span>}
            {parseError && <span className="la-parse-error">⚠️ {parseError}</span>}
          </div>
        </div>
      )}

      {workingLogs.length > 0 && (
        <div className="la-stats-bar">
          <div className="la-stat"><span className="la-stat-num">{workingLogs.length}</span><span className="la-stat-label">Total Requests</span></div>
          <div className="la-stat"><span className="la-stat-num" style={{ color: '#ff3355' }}>{totalErrors}</span><span className="la-stat-label">Errors</span></div>
          <div className="la-stat"><span className="la-stat-num" style={{ color: '#f59e0b' }}>{errorRate}%</span><span className="la-stat-label">Error Rate</span></div>
          <div className="la-stat"><span className="la-stat-num" style={{ color: '#a78bfa' }}>{clusters.length}</span><span className="la-stat-label">Clusters</span></div>
        </div>
      )}

      {workingLogs.length > 0 && (
        <div className="la-body">

          <div className="la-card">
            <h3 className="la-card-title">
              📈 Full Request Timeline
              {timeLabel && <span className="la-timeline-span-label"> · {timeLabel} · {timeline.length} buckets</span>}
            </h3>
            <div className="la-timeline">
              {timeline.map((bucket, i) => (
                <div key={i} className="la-bucket">
                  <div className="la-bars">
                    <div className="la-bar la-bar-total" style={{ height: `${Math.max((bucket.total / maxBar) * 80, bucket.total > 0 ? 4 : 0)}px` }} title={`${bucket.total} requests`} />
                    <div className="la-bar la-bar-error" style={{ height: `${Math.max((bucket.errors / maxBar) * 80, bucket.errors > 0 ? 4 : 0)}px` }} title={`${bucket.errors} errors`} />
                  </div>
                  <div className="la-bucket-label">{bucket.label}</div>
                  {bucket.errors > 0 && <div className="la-bucket-rate">{bucket.errorRate}%</div>}
                </div>
              ))}
            </div>
            <div className="la-timeline-legend">
              <span><span className="la-dot la-dot-total" /> Total requests</span>
              <span><span className="la-dot la-dot-error" /> Errors</span>
            </div>
          </div>

          <div className="la-card">
            <h3 className="la-card-title">🗂️ Similar Failure Clusters</h3>
            {clusters.length === 0 ? (
              <div className="la-empty">No errors found — system looks healthy ✅</div>
            ) : (
              <div className="la-clusters">
                {clusters.map((cluster, i) => {
                  const sev = getSeverity(cluster.statusCode);
                  return (
                    <div key={i} className="la-cluster" style={{ borderLeftColor: sev.color }}>
                      <div className="la-cluster-top">
                        <div className="la-cluster-code" style={{ color: sev.color }}>HTTP {cluster.statusCode}</div>
                        <div className="la-cluster-sev" style={{ background: sev.color }}>{sev.label}</div>
                        <div className="la-cluster-count">×{cluster.count}</div>
                      </div>
                      <div className="la-cluster-msg">{cluster.message.substring(0, 120)}</div>
                      <div className="la-cluster-meta">
                        <span>🖥️ {cluster.backends.join(', ')}</span>
                        <span>🔗 {cluster.paths.slice(0, 3).join(', ')}</span>
                        <span>🕐 {new Date(cluster.firstSeen).toLocaleTimeString()} → {new Date(cluster.lastSeen).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="la-card la-ai-card">
            <h3 className="la-card-title">🤖 AI Incident Summary (Groq)</h3>
            <p className="la-ai-desc">
              Sends your logs to Groq AI via the proxy and returns a plain-English diagnosis, root cause, and action plan.
            </p>
            <button className="la-ai-btn" onClick={runAI} disabled={aiLoading}>
              {aiLoading ? '⏳ Generating with Groq...' : '✨ Generate Incident Summary'}
            </button>
            {aiError && <div className="la-ai-error">{aiError}</div>}
            {aiSummary && (
              <div className="la-ai-result">
                <div className="la-ai-result-header">📋 Incident Report — Generated by Groq AI</div>
                <div className="la-ai-text" dangerouslySetInnerHTML={{ __html: renderSummary(aiSummary) }} />
              </div>
            )}
            {!aiSummary && !aiLoading && (
              <div className="la-ai-placeholder">
                Click above to get an AI-powered incident summary with root cause and action steps.
              </div>
            )}
          </div>

        </div>
      )}

      {workingLogs.length === 0 && (
        <div className="la-empty-state">
          📋 Paste your log lines above and click Parse Logs to start analysis.
        </div>
      )}
    </section>
  );
};

export default LogAnalysis;
