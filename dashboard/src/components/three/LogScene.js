import React, { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// ── Canary node: represents a server instance ──────────────────────────────
function ServerNode({ position, color, size, speed, offset, isCanary }) {
  const mesh = useRef();
  const ring = useRef();
  const { mouse } = useThree();

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const floatX = Math.sin(t * speed + offset) * 0.18;
    const floatY = Math.cos(t * speed * 0.7 + offset) * 0.14;

    mesh.current.position.x = position[0] + floatX + mouse.x * 0.6;
    mesh.current.position.y = position[1] + floatY + mouse.y * 0.6;
    mesh.current.position.z = position[2];

    mesh.current.rotation.y += 0.008;
    mesh.current.rotation.x += 0.004;

    if (ring.current) {
      ring.current.position.copy(mesh.current.position);
      ring.current.rotation.x = Math.PI / 2 + t * 0.3;
      ring.current.rotation.y = t * 0.5;
      const pulse = 1 + Math.sin(t * 2 + offset) * 0.15;
      ring.current.scale.set(pulse, pulse, pulse);
    }
  });

  return (
    <>
      <mesh ref={mesh} position={position}>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isCanary ? 1.2 : 0.5}
          roughness={0.05}
          metalness={0.95}
          wireframe={false}
        />
      </mesh>
      {/* orbital ring around canary nodes */}
      {isCanary && (
        <mesh ref={ring} position={position}>
          <torusGeometry args={[size * 2.5, 0.008, 6, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
        </mesh>
      )}
    </>
  );
}

// ── Traffic edges between nodes ────────────────────────────────────────────
function TrafficEdges({ nodes }) {
  const ref = useRef();
  const { mouse } = useThree();

  const geometry = useMemo(() => {
    const pts = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].position;
        const b = nodes[j].position;
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (dist < 5.5) {
          pts.push(new THREE.Vector3(...a));
          pts.push(new THREE.Vector3(...b));
        }
      }
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [nodes]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = t * 0.004 + mouse.x * 0.06;
    ref.current.rotation.x = mouse.y * 0.06;
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color="#00ff88" transparent opacity={0.12} />
    </lineSegments>
  );
}

// ── Packet: animated dot traveling along edges ─────────────────────────────
function Packets() {
  const ref = useRef();
  const { mouse } = useThree();

  const { positions, colors } = useMemo(() => {
    const count = 180;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 5 + Math.random() * 6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);

      // mix of green (ok) and red (error) packets
      if (Math.random() > 0.15) {
        col[i * 3] = 0.0; col[i * 3 + 1] = 1.0; col[i * 3 + 2] = 0.53;
      } else {
        col[i * 3] = 1.0; col[i * 3 + 1] = 0.27; col[i * 3 + 2] = 0.27;
      }
    }
    return { positions: pos, colors: col };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (!ref.current) return;
    ref.current.rotation.y = t * 0.025 + mouse.x * 0.15;
    ref.current.rotation.x = t * 0.012 + mouse.y * 0.15;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.055} vertexColors transparent opacity={0.75} sizeAttenuation />
    </points>
  );
}

// ── Hexagonal grid plane (ground) ──────────────────────────────────────────
function GridPlane() {
  const ref = useRef();
  const { mouse } = useThree();

  useFrame(() => {
    if (!ref.current) return;
    ref.current.rotation.x = -Math.PI / 2.4 + mouse.y * 0.04;
    ref.current.rotation.z = mouse.x * 0.04;
  });

  return (
    <mesh ref={ref} position={[0, -5, 0]} rotation={[-Math.PI / 2.4, 0, 0]}>
      <planeGeometry args={[40, 40, 20, 20]} />
      <meshBasicMaterial color="#00ff88" wireframe transparent opacity={0.04} />
    </mesh>
  );
}

// ── Outer scanning ring ────────────────────────────────────────────────────
function ScanRing({ radius, color, speed, tilt }) {
  const ref = useRef();
  const { mouse } = useThree();

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    ref.current.rotation.x = tilt + t * speed + mouse.y * 0.12;
    ref.current.rotation.y = t * speed * 0.6 + mouse.x * 0.12;
  });

  return (
    <mesh ref={ref}>
      <torusGeometry args={[radius, 0.01, 6, 90]} />
      <meshBasicMaterial color={color} transparent opacity={0.13} />
    </mesh>
  );
}

// ── Full scene ─────────────────────────────────────────────────────────────
function Scene() {
  const nodes = useMemo(() => {
    // stable servers = green/cyan, canary = yellow/orange
    const stableColors = ["#00ff88", "#22d3ee", "#10b981"];
    const canaryColors = ["#f59e0b", "#fb923c", "#fbbf24"];

    const arr = [];
    // 8 stable nodes
    for (let i = 0; i < 8; i++) {
      arr.push({
        position: [
          (Math.random() - 0.5) * 13,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 5,
        ],
        color: stableColors[i % stableColors.length],
        size: 0.12 + Math.random() * 0.18,
        speed: 0.25 + Math.random() * 0.3,
        offset: Math.random() * Math.PI * 2,
        isCanary: false,
      });
    }
    // 4 canary nodes
    for (let i = 0; i < 4; i++) {
      arr.push({
        position: [
          (Math.random() - 0.5) * 13,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 5,
        ],
        color: canaryColors[i % canaryColors.length],
        size: 0.14 + Math.random() * 0.14,
        speed: 0.4 + Math.random() * 0.4,
        offset: Math.random() * Math.PI * 2,
        isCanary: true,
      });
    }
    return arr;
  }, []);

  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[8, 6, 4]}   intensity={2.5} color="#00ff88" />
      <pointLight position={[-8, -6, -4]} intensity={1.5} color="#22d3ee" />
      <pointLight position={[0, 8, -2]}  intensity={1.0} color="#f59e0b" />

      <GridPlane />
      <ScanRing radius={7}  color="#00ff88" speed={0.05} tilt={0} />
      <ScanRing radius={9}  color="#22d3ee" speed={0.03} tilt={Math.PI / 4} />
      <ScanRing radius={11} color="#f59e0b" speed={0.02} tilt={Math.PI / 6} />

      <Packets />
      <TrafficEdges nodes={nodes} />
      {nodes.map((n, i) => <ServerNode key={i} {...n} />)}
    </>
  );
}

// ── Export ─────────────────────────────────────────────────────────────────
export default function LogScene({ logs }) {
  return (
    <div style={{
      position: "fixed",
      top: 0, left: 0,
      width: "100vw", height: "100vh",
      zIndex: 0,
      pointerEvents: "none",
    }}>
      <Canvas
        camera={{ position: [0, 0, 10], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}