import React, { useState, useEffect } from 'react';

const Navbar = ({ onEnterDashboard, onGoHome }) => {
  const [navScrolled, setNavScrolled] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = ['Features', 'How It Works', 'Stats', 'Docs'];

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 40px',
      height: 64,
      background: navScrolled ? 'rgba(2,8,16,0.92)' : 'transparent',
      backdropFilter: navScrolled ? 'blur(12px)' : 'none',
      borderBottom: navScrolled ? '1px solid rgba(0,220,155,0.08)' : '1px solid transparent',
      transition: 'all 0.4s ease',
    }}>
      {/* Logo */}
      <div
  onClick={onGoHome}
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer'
  }}
>
        <div style={{
          width: 32, height: 32, border: '1px solid #00dc9b',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#00dc9b', fontSize: 16,
          boxShadow: '0 0 12px rgba(0,220,155,0.3)',
          animation: 'glowPulse 3s ease infinite',
        }}>⬡</div>
        <div style={{
          fontFamily: "'Orbitron', monospace", fontSize: 14, fontWeight: 900,
          color: '#e0f0ee', letterSpacing: 3,
        }}>
          LogWatch<span style={{ color: '#00dc9b' }}>AI</span>
        </div>
      </div>

      {/* Nav Links */}
      <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        {navLinks.map(link => (
          <a
            key={link}
            href={`#${link.toLowerCase().replace(' ', '-')}`}
            style={{
              fontFamily: "'Orbitron', monospace", fontSize: 10, letterSpacing: 2,
              color: '#2a6a60', textDecoration: 'none', transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.target.style.color = '#00dc9b'}
            onMouseLeave={e => e.target.style.color = '#2a6a60'}
          >
            {link}
          </a>
        ))}
      </div>

      {/* CTA + Hamburger */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={onEnterDashboard}
          style={{
            padding: '9px 22px',
            background: 'rgba(0,220,155,0.08)',
            border: '1px solid #00dc9b',
            color: '#00dc9b',
            fontFamily: "'Orbitron', monospace",
            fontSize: 10, letterSpacing: 2,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(0,220,155,0.18)';
            e.currentTarget.style.boxShadow = '0 0 24px rgba(0,220,155,0.3)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(0,220,155,0.08)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          OPEN DASHBOARD →
        </button>

        <button
          className="hamburger"
          onClick={() => setMobileMenu(m => !m)}
          style={{
            display: 'none', background: 'none', border: 'none',
            color: '#00dc9b', fontSize: 20, cursor: 'pointer',
          }}
        >
          ☰
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileMenu && (
        <div style={{
          position: 'absolute', top: 64, left: 0, right: 0,
          background: 'rgba(2,8,16,0.97)',
          borderBottom: '1px solid rgba(0,220,155,0.1)',
          padding: '20px 40px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {navLinks.map(link => (
            <a
              key={link}
              href={`#${link.toLowerCase().replace(' ', '-')}`}
              onClick={() => setMobileMenu(false)}
              style={{
                fontFamily: "'Orbitron', monospace", fontSize: 11, letterSpacing: 2,
                color: '#2a6a60', textDecoration: 'none',
              }}
            >
              {link}
            </a>
          ))}
          <button
            onClick={() => { setMobileMenu(false); onEnterDashboard(); }}
            style={{
              padding: '10px', background: 'rgba(0,220,155,0.08)',
              border: '1px solid #00dc9b', color: '#00dc9b',
              fontFamily: "'Orbitron', monospace", fontSize: 10,
              letterSpacing: 2, cursor: 'pointer',
            }}
          >
            OPEN DASHBOARD →
          </button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;