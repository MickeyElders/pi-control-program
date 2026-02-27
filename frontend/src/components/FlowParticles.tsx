import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type FlowParticlesProps = {
  curve: THREE.Curve<THREE.Vector3>;
  count?: number;
  speed?: number;
  size?: number;
  color?: [number, number, number];
  active?: boolean;
};

const makeOffsets = (count: number) => {
  const offsets = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    offsets[i] = i / count;
  }
  return offsets;
};

export default function FlowParticles({
  curve,
  count = 120,
  speed = 0.25,
  size = 0.08,
  color = [80, 200, 255],
  active = false,
}: FlowParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const offsets = useMemo(() => makeOffsets(count), [count]);
  const positions = useMemo(() => new Float32Array(count * 3), [count]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  const colorValue = useMemo(
    () => new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255),
    [color]
  );

  useFrame((state) => {
    if (!pointsRef.current) return;
    const material = pointsRef.current.material as THREE.PointsMaterial;
    material.opacity = active ? 0.95 : 0.0;
    if (!active) return;

    const positionAttr = pointsRef.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = positionAttr.array as Float32Array;
    const time = state.clock.elapsedTime;
    for (let i = 0; i < offsets.length; i += 1) {
      const t = (offsets[i] + time * speed) % 1;
      const pos = curve.getPointAt(t);
      arr[i * 3] = pos.x;
      arr[i * 3 + 1] = pos.y;
      arr[i * 3 + 2] = pos.z;
    }
    positionAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color={colorValue}
        size={size}
        transparent
        opacity={active ? 0.95 : 0.0}
        depthWrite={false}
      />
    </points>
  );
}
