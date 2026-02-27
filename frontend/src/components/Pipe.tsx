import { useMemo } from "react";
import * as THREE from "three";

export type PipeProps = {
  curve: THREE.Curve<THREE.Vector3>;
  radius?: number;
  segments?: number;
  color?: string | number;
  metalness?: number;
  roughness?: number;
};

export default function Pipe({
  curve,
  radius = 0.08,
  segments = 120,
  color = 0x6b7f94,
  metalness = 0.6,
  roughness = 0.35,
}: PipeProps) {
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, segments, radius, 12, false), [
    curve,
    segments,
    radius,
  ]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
    </mesh>
  );
}
