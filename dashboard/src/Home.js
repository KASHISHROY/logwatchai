import React, { useEffect, useRef, useState } from 'react';



// ── Cursor-reactive particle background ───────────────────────────────────────
function ParticleBackground() {
  const canvasRef = useRef(null);
  const mouse = useRef({ x: 0.5, y: 0.5 });
  const targetMouse = useRef({ x: 0.5, y: 0.5 });
  const animRef = useRef(null);
  const nodesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let W = window.innerWidth, H = window.innerHeight;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => {
      targetMouse.current = { x: e.clientX / W, y: e.clientY / H };
    });

    const cols = 24, rows = 15;
    nodesRef.current = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        nodesRef.current.push({
          bx: (i / (cols - 1)) * W,
          by: (j / (rows - 1)) * H,
          x: (i / (cols - 1)) * W,
          y: (j / (rows - 1)) * H,
          size: Math.random() * 1.5 + 0.5,
          pulse: Math.random() * Math.PI * 2,
        });
      }
    }

    let t = 0;
    const draw = () => {
      mouse.current.x += (targetMouse.current.x - mouse.current.x) * 0.05;
      mouse.current.y += (targetMouse.current.y - mouse.current.y) * 0.05;
      ctx.clearRect(0, 0, W, H);

      const grad = ctx.createRadialGradient(mouse.current.x * W, mouse.current.y * H, 0, W / 2, H / 2, Math.max(W, H));
      grad.addColorStop(0, '#050d1a');
      grad.addColorStop(0.4, '#020810');
      grad.addColorStop(1, '#000305');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      const cg = ctx.createRadialGradient(mouse.current.x * W, mouse.current.y * H, 0, mouse.current.x * W, mouse.current.y * H, 350);
      cg.addColorStop(0, 'rgba(0,220,180,0.07)');
      cg.addColorStop(0.5, 'rgba(0,120,255,0.04)');
      cg.addColorStop(1, 'transparent');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, W, H);

      for (let y = 0; y < H; y += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        ctx.fillRect(0, y, W, 1);
      }

      const mx = mouse.current.x * W, my = mouse.current.y * H;
      nodesRef.current.forEach((n) => {
        const dx = mx - n.bx, dy = my - n.by;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pull = Math.max(0, 1 - dist / 380);
        n.pulse += 0.015;
        const tx = n.bx + dx * pull * 0.18 + Math.sin(t * 0.4 + n.pulse) * 6;
        const ty = n.by + dy * pull * 0.18 + Math.cos(t * 0.3 + n.pulse) * 6;
        n.x += (tx - n.x) * 0.08;
        n.y += (ty - n.y) * 0.08;
        const alpha = 0.2 + pull * 0.8 + Math.sin(n.pulse) * 0.1;
        const size = n.size + pull * 2.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        ctx.fillStyle = pull > 0.3 ? `rgba(0,220,180,${alpha})` : `rgba(0,100,200,${alpha * 0.6})`;
        ctx.fill();
      });

      const nodes = nodesRef.current;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 90) {
            const alpha = (1 - d / 90) * 0.15;
            const adx = mx - a.x, ady = my - a.y;
            const near = Math.sqrt(adx * adx + ady * ady) < 260;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = near ? `rgba(0,220,180,${alpha * 3})` : `rgba(0,100,200,${alpha})`;
            ctx.lineWidth = near ? 0.8 : 0.4;
            ctx.stroke();
          }
        }
      }

      const sweepY = (t * 0.4) % H;
      const sg = ctx.createLinearGradient(0, sweepY - 40, 0, sweepY + 2);
      sg.addColorStop(0, 'transparent');
      sg.addColorStop(1, 'rgba(0,220,180,0.04)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, sweepY - 40, W, 42);

      t++;
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas ref={canvasRef} style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      zIndex: 0, pointerEvents: 'none',
    }} />
  );
}

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ target, suffix = '', duration = 2000 }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      let start = null;
      const step = (ts) => {
        if (!start) start = ts;
        const progress = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setCount(Math.floor(eased * target));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, duration]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

// ── Feature Card ──────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, desc, accent, delay }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        padding: '28px 24px',
        background: hovered ? `rgba(0,8,20,0.85)` : 'rgba(0,5,12,0.6)',
        border: `1px solid ${hovered ? accent : 'rgba(0,200,160,0.18)'}`,
        backdropFilter: 'blur(8px)',
        transition: 'all 0.3s ease',
        boxShadow: hovered ? `0 0 32px ${accent}22, inset 0 0 32px ${accent}06` : 'none',
        animationDelay: delay,
        animation: 'fadeUp 0.6s ease backwards',
        overflow: 'hidden',
        cursor: 'default',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `2px solid ${accent}`, borderLeft: `2px solid ${accent}` }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `2px solid ${accent}`, borderRight: `2px solid ${accent}` }} />
      <div style={{ fontSize: 28, marginBottom: 14 }}>{icon}</div>
      <div style={{
        fontFamily: "'Orbitron', monospace", fontSize: 12, fontWeight: 700,
        color: accent, letterSpacing: 2, marginBottom: 10,
        textShadow: hovered ? `0 0 12px ${accent}` : 'none',
        transition: 'text-shadow 0.3s',
      }}>{title}</div>
      <div style={{
        fontFamily: "'Share Tech Mono', monospace", fontSize: 13,
        /* ✅ FIXED: was #3a6a62 (near-invisible), now bright readable grey-green */
        color: '#8ecfbf',
        lineHeight: 1.8, letterSpacing: 0.5,
      }}>{desc}</div>
    </div>
  );
}

// ── Stat Block ────────────────────────────────────────────────────────────────
function StatBlock({ value, suffix, label, accent }) {
  return (
    <div style={{ textAlign: 'center', padding: '0 24px' }}>
      <div style={{
        fontFamily: "'Orbitron', monospace", fontSize: 42, fontWeight: 900,
        color: accent, textShadow: `0 0 30px ${accent}88`,
        lineHeight: 1, marginBottom: 8,
      }}>
        <Counter target={value} suffix={suffix} />
      </div>
      <div style={{
        fontFamily: "'Share Tech Mono', monospace", fontSize: 11,
        /* ✅ FIXED: was #2a5a52 (nearly invisible), now legible */
        color: '#6ab8a8',
        letterSpacing: 3, textTransform: 'uppercase',
      }}>{label}</div>
    </div>
  );
}

// ── Main Home Component ───────────────────────────────────────────────────────
const Home = ({ onEnterDashboard, onGoWorkflow }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTimeout(() => setMounted(true), 80);
  }, []);

  return (
    <>
      <style>{css}</style>
      <ParticleBackground />

      {/* ── PAGE CONTENT ── */}
      <div style={{
        position: 'relative', zIndex: 1,
        opacity: mounted ? 1 : 0, transition: 'opacity 0.8s ease',
        fontFamily: "'Share Tech Mono', monospace",
      }}>

        {/* ── HERO ── */}
        <section style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '120px 24px 80px', textAlign: 'center',
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 16px',
            border: '1px solid rgba(0,220,155,0.3)',
            background: 'rgba(0,220,155,0.07)',
            marginBottom: 40, animation: 'fadeUp 0.5s ease backwards',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: '#00dc9b',
              boxShadow: '0 0 8px #00dc9b', animation: 'pulse 1.5s infinite',
            }} />
            <span style={{ fontFamily: "'Orbitron', monospace", fontSize: 9, color: '#00dc9b', letterSpacing: 3 }}>
              SYSTEM OPERATIONAL · v2.4.1
            </span>
          </div>

          <h1 style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: 'clamp(36px, 7vw, 88px)',
            fontWeight: 900, lineHeight: 1.05,
            color: '#e8f8f4', letterSpacing: 4,
            textShadow: '0 0 60px rgba(0,220,155,0.2)',
            marginBottom: 12,
            animation: 'fadeUp 0.5s 0.1s ease backwards',
          }}>
            Log<span style={{ color: '#00dc9b', textShadow: '0 0 40px #00dc9b' }}>Watch</span>
            <span style={{ color: '#00b4ff', textShadow: '0 0 40px #00b4ff' }}>AI</span>
          </h1>

          {/* ✅ FIXED: was #2a7a6a (hard to read), now bright teal */}
          <p style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 'clamp(13px, 2vw, 18px)',
            color: '#7dd8c8', letterSpacing: 3,
            marginBottom: 8,
            animation: 'fadeUp 0.5s 0.2s ease backwards',
          }}>
            Intelligent log analysis · canary deployment · auto-rollback
          </p>

          {/* ✅ FIXED: was #1a4a40 (near-black on dark bg), now readable */}
          <p style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: 'clamp(11px, 1.4vw, 14px)',
            color: '#5ab8a5', letterSpacing: 2,
            maxWidth: 680, lineHeight: 1.9,
            marginBottom: 52,
            animation: 'fadeUp 0.5s 0.3s ease backwards',
          }}>
            Real-time traffic control · AI-powered incident detection · zero-downtime deployments
            <br />
            From anomaly spike to root-cause report in seconds — not hours.
          </p>

          <div style={{
            display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center',
            animation: 'fadeUp 0.5s 0.4s ease backwards',
          }}>
            <button
              onClick={onEnterDashboard}
              style={{
                padding: '16px 36px',
                background: 'rgba(0,220,155,0.1)',
                border: '1px solid #00dc9b',
                color: '#00dc9b',
                fontFamily: "'Orbitron', monospace",
                fontSize: 12, letterSpacing: 3,
                cursor: 'pointer', transition: 'all 0.2s ease',
                boxShadow: '0 0 24px rgba(0,220,155,0.15)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(0,220,155,0.2)';
                e.currentTarget.style.boxShadow = '0 0 40px rgba(0,220,155,0.35)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(0,220,155,0.1)';
                e.currentTarget.style.boxShadow = '0 0 24px rgba(0,220,155,0.15)';
              }}
            >
              ⬡ VIEW DASHBOARD
            </button>
            <button
              onClick={onGoWorkflow}
              style={{
                padding: '16px 36px',
                background: 'transparent',
                border: '1px solid rgba(0,180,255,0.4)',
                color: '#00b4ff',
                fontFamily: "'Orbitron', monospace",
                fontSize: 12, letterSpacing: 3,
                cursor: 'pointer', transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(0,180,255,0.08)';
                e.currentTarget.style.borderColor = '#00b4ff';
                e.currentTarget.style.boxShadow = '0 0 24px rgba(0,180,255,0.2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(0,180,255,0.4)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              ◈ WORKFLOW
            </button>
          </div>

          <div style={{
            position: 'absolute', bottom: 36,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            animation: 'fadeUp 0.5s 0.8s ease backwards',
          }}>
            {/* ✅ FIXED: was #1a4040, now visible */}
            <span style={{ fontFamily: "'Orbitron', monospace", fontSize: 8, color: '#4a9080', letterSpacing: 3 }}>SCROLL</span>
            <div style={{ width: 1, height: 32, background: 'linear-gradient(180deg, #00dc9b66, transparent)', animation: 'scrollPulse 2s ease infinite' }} />
          </div>
        </section>

        {/* ── STATS ── */}
        <section id="stats" style={{
          padding: '60px 24px',
          borderTop: '1px solid rgba(0,220,155,0.08)',
          borderBottom: '1px solid rgba(0,220,155,0.08)',
          background: 'rgba(0,5,12,0.5)',
        }}>
          <div style={{
            maxWidth: 1000, margin: '0 auto',
            display: 'flex', justifyContent: 'space-around',
            flexWrap: 'wrap', gap: 40,
          }}>
            <StatBlock value={99}  suffix=".9%"  label="Uptime SLA"          accent="#00dc9b" />
            <StatBlock value={50}  suffix="ms"   label="Avg Detection Time"   accent="#00b4ff" />
            <StatBlock value={10}  suffix="x"    label="Faster Rollback"      accent="#f59e0b" />
            <StatBlock value={100} suffix="k+"   label="Logs Analysed / min"  accent="#a78bfa" />
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section id="features" style={{ padding: '100px 24px', maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 10, color: '#00dc9b', letterSpacing: 4, marginBottom: 16 }}>
              // CAPABILITIES
            </div>
            <h2 style={{
              fontFamily: "'Orbitron', monospace", fontSize: 'clamp(22px, 4vw, 36px)',
              fontWeight: 900, color: '#e8f8f4', letterSpacing: 3, marginBottom: 16,
            }}>
              Everything your infra needs
            </h2>
            {/* ✅ FIXED: was #2a5a52, now readable */}
            <p style={{
              fontFamily: "'Share Tech Mono', monospace", fontSize: 13,
              color: '#7ecfbe', maxWidth: 520, margin: '0 auto', lineHeight: 1.8, letterSpacing: 1,
            }}>
              One platform to monitor, analyse, and control your deployment pipeline — powered by AI at every layer.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            <FeatureCard delay="0s"    accent="#00dc9b" icon="🔬" title="AI LOG ANALYSIS"         desc="Cluster similar failures automatically. Get plain-English root cause reports generated by Groq AI in seconds, not hours of manual triage." />
            <FeatureCard delay="0.08s" accent="#00b4ff" icon="⬡"  title="CANARY DEPLOYMENT"       desc="Gradually shift traffic between stable and canary builds. Fine-tune split percentages with one click — no config file edits required." />
            <FeatureCard delay="0.16s" accent="#ff3355" icon="⏮"  title="AUTO ROLLBACK"           desc="Crosses the error-rate threshold? Instantly rolls back to stable automatically — before your users even notice something went wrong." />
            <FeatureCard delay="0.24s" accent="#f59e0b" icon="📈"  title="REAL-TIME TIMELINE"      desc="Full request timeline across your entire log history. Adaptive bucket sizes from seconds to days. Error rates visualised at a glance." />
            <FeatureCard delay="0.32s" accent="#a78bfa" icon="🗂️" title="FAILURE CLUSTERING"      desc="Groups repeated errors by status code and message fingerprint. See which backends are affected, which paths, and exactly when it started." />
            <FeatureCard delay="0.40s" accent="#00dc9b" icon="📋"  title="PASTE & UPLOAD LOGS"    desc="Not running live? Paste JSON log lines or upload .log / .txt / .json files. Full analysis pipeline works on any historical data instantly." />
            <FeatureCard delay="0.42s" accent="#00ffcc" icon="🛠️" title="AI CODE PATCH GENERATOR" desc="Generates fix → tests in sandbox → deploys after approval." />
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" style={{
          padding: '100px 24px',
          background: 'rgba(0,5,12,0.5)',
          borderTop: '1px solid rgba(0,220,155,0.08)',
          borderBottom: '1px solid rgba(0,220,155,0.08)',
        }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 64 }}>
              <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 10, color: '#00b4ff', letterSpacing: 4, marginBottom: 16 }}>
                // ARCHITECTURE
              </div>
              <h2 style={{
                fontFamily: "'Orbitron', monospace", fontSize: 'clamp(22px, 4vw, 36px)',
                fontWeight: 900, color: '#e8f8f4', letterSpacing: 3,
              }}>
                How it works
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[
                { step: '01', title: 'TRAFFIC INGRESS',         desc: 'All requests flow through the LogWatch proxy. Every request is timestamped, tagged with backend identity, and logged in real time.',                         accent: '#00dc9b' },
                { step: '02', title: 'CANARY SPLITTING',        desc: 'Configurable traffic weights route a percentage of requests to the canary build. Switch between stable, 10% canary, or 100% test mode instantly.',         accent: '#00b4ff' },
                { step: '03', title: 'ANOMALY DETECTION',       desc: 'Error rates are tracked per time window. When the threshold is crossed, auto-rollback triggers immediately and the event is logged.',                       accent: '#f59e0b' },
                { step: '04', title: 'AI INCIDENT REPORT',      desc: 'Logs are sent to Groq AI which returns a structured incident report: what broke, why, which backend, and the recommended fix.',                             accent: '#a78bfa' },
                { step: '05', title: 'AI CODE PATCH GENERATOR', desc: 'Generates fix → tests in sandbox → deploys after approval.',                                                                                                 accent: '#00ffcc' },
              ].map((item, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 32, alignItems: 'flex-start',
                  padding: '32px 0',
                  borderBottom: i < 4 ? '1px solid rgba(0,220,155,0.07)' : 'none',
                  animation: `fadeUp 0.5s ${i * 0.1}s ease backwards`,
                }}>
                  <div style={{
                    fontFamily: "'Orbitron', monospace", fontSize: 42, fontWeight: 900,
                    color: item.accent, opacity: 0.22, lineHeight: 1,
                    flexShrink: 0, width: 80, textAlign: 'right',
                  }}>{item.step}</div>
                  <div>
                    <div style={{
                      fontFamily: "'Orbitron', monospace", fontSize: 12, fontWeight: 700,
                      color: item.accent, letterSpacing: 3, marginBottom: 10,
                    }}>{item.title}</div>
                    {/* ✅ FIXED: was #3a6a62, now clearly readable */}
                    <div style={{
                      fontFamily: "'Share Tech Mono', monospace", fontSize: 13,
                      color: '#8ecfbf', lineHeight: 1.9, letterSpacing: 0.5,
                    }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA BANNER ── */}
        <section style={{ padding: '100px 24px', textAlign: 'center', maxWidth: 800, margin: '0 auto' }}>
          <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 10, color: '#00dc9b', letterSpacing: 4, marginBottom: 24 }}>
            // READY TO DEPLOY
          </div>
          <h2 style={{
            fontFamily: "'Orbitron', monospace",
            fontSize: 'clamp(24px, 5vw, 48px)',
            fontWeight: 900, color: '#e8f8f4',
            letterSpacing: 3, marginBottom: 20, lineHeight: 1.2,
          }}>
            Your infra deserves<br />
            <span style={{ color: '#00dc9b', textShadow: '0 0 30px #00dc9b88' }}>real intelligence.</span>
          </h2>
          {/* ✅ FIXED: was #2a5a52, now readable */}
          <p style={{
            fontFamily: "'Share Tech Mono', monospace", fontSize: 13,
            color: '#7ecfbe', letterSpacing: 2, lineHeight: 1.9, marginBottom: 40,
          }}>
            Stop manually reading logs. Let LogWatch AI surface what matters,<br />
            roll back what breaks, and explain what went wrong — automatically.
          </p>
          <button
            onClick={onEnterDashboard}
            style={{
              padding: '18px 48px',
              background: 'rgba(0,220,155,0.1)',
              border: '1px solid #00dc9b',
              color: '#00dc9b',
              fontFamily: "'Orbitron', monospace",
              fontSize: 13, letterSpacing: 4,
              cursor: 'pointer',
              boxShadow: '0 0 32px rgba(0,220,155,0.2)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(0,220,155,0.2)';
              e.currentTarget.style.boxShadow = '0 0 60px rgba(0,220,155,0.4)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(0,220,155,0.1)';
              e.currentTarget.style.boxShadow = '0 0 32px rgba(0,220,155,0.2)';
            }}
          >
            ⬡ ENTER DASHBOARD
          </button>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{
          borderTop: '1px solid rgba(0,220,155,0.08)',
          padding: '32px 40px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#00dc9b', fontSize: 16 }}>⬡</span>
            <span style={{ fontFamily: "'Orbitron', monospace", fontSize: 11, color: '#4aaa90', letterSpacing: 2 }}>
              LogWatch<span style={{ color: '#00dc9b' }}>AI</span>
            </span>
          </div>
          {/* ✅ FIXED: was #0a2828 (virtually invisible), now soft readable grey */}
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: '#4a9080', letterSpacing: 2 }}>
            RAG · PINECONE · GROQ · {new Date().getFullYear()}
          </div>
          <div style={{ fontFamily: "'Orbitron', monospace", fontSize: 9, color: '#4a9080', letterSpacing: 2 }}>
            BUILT FOR ZERO-DOWNTIME TEAMS
          </div>
        </footer>
      </div>
    </>
  );
};

// ── Global CSS ────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #000305; overflow-x: hidden; cursor: crosshair; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #00dc9b33; border-radius: 2px; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; } 50% { opacity: 0.3; }
  }
  @keyframes glowPulse {
    0%, 100% { box-shadow: 0 0 12px rgba(0,220,155,0.3); }
    50%       { box-shadow: 0 0 24px rgba(0,220,155,0.6); }
  }
  @keyframes scrollPulse {
    0%, 100% { opacity: 0.4; transform: scaleY(1); }
    50%       { opacity: 1;   transform: scaleY(1.15); }
  }

  @media (max-width: 768px) {
    .nav-links { display: none !important; }
    .hamburger { display: flex !important; }
  }
`;

export default Home;