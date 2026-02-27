import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type TankMaterialConfig = {
  glass?: {
    color: string;
    roughness: number;
    metalness: number;
    transmission: number;
    thickness: number;
    opacity: number;
    clearcoat: number;
    ior: number;
  };
  rim?: {
    color: string;
    metalness: number;
    roughness: number;
  };
  liquid?: {
    roughness: number;
    metalness: number;
    opacity: number;
    emissiveIntensity: number;
  };
};

export type TankProps = {
  position: [number, number, number];
  radius: number;
  height: number;
  level: number;
  color: [number, number, number];
  material?: TankMaterialConfig;
};

const DEFAULT_MATERIAL: Required<TankMaterialConfig> = {
  glass: {
    color: "#9dd6ff",
    roughness: 0.08,
    metalness: 0.05,
    transmission: 0.88,
    thickness: 0.6,
    opacity: 0.32,
    clearcoat: 0.8,
    ior: 1.2,
  },
  rim: {
    color: "#d4dde8",
    metalness: 0.7,
    roughness: 0.2,
  },
  liquid: {
    roughness: 0.08,
    metalness: 0.05,
    opacity: 0.78,
    emissiveIntensity: 0.25,
  },
};

const clampLevel = (value: number) => Math.max(0.05, Math.min(1, value));

const toColor = (rgb: [number, number, number]) =>
  new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

export default function Tank({ position, radius, height, level, color, material }: TankProps) {
  const liquidRef = useRef<THREE.Mesh>(null);

  const glass = material?.glass ?? DEFAULT_MATERIAL.glass;
  const rim = material?.rim ?? DEFAULT_MATERIAL.rim;
  const liquid = material?.liquid ?? DEFAULT_MATERIAL.liquid;

  const liquidColor = useMemo(() => toColor(color), [color]);
  const clamped = clampLevel(level);

  useEffect(() => {
    if (!liquidRef.current) return;
    const mesh = liquidRef.current;
    mesh.scale.y = clamped;
    mesh.position.y = (height * clamped) / 2 + 0.02;
  }, [clamped, height]);

  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius, radius, height, 48, 1, true]} />
        <meshPhysicalMaterial
          color={glass.color}
          roughness={glass.roughness}
          metalness={glass.metalness}
          transmission={glass.transmission}
          thickness={glass.thickness}
          transparent
          opacity={glass.opacity}
          clearcoat={glass.clearcoat}
          ior={glass.ior}
        />
      </mesh>

      <mesh position={[0, height + 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 1.02, radius * 0.07, 16, 64]} />
        <meshStandardMaterial color={rim.color} metalness={rim.metalness} roughness={rim.roughness} />
      </mesh>

      <mesh position={[0, height + 0.04, 0]}>
        <cylinderGeometry args={[radius * 0.98, radius * 0.98, height * 0.04, 48]} />
        <meshStandardMaterial color={rim.color} metalness={rim.metalness} roughness={rim.roughness} />
      </mesh>

      <mesh position={[0, height * 0.04, 0]}>
        <cylinderGeometry args={[radius * 1.12, radius * 1.12, height * 0.08, 36]} />
        <meshStandardMaterial color={rim.color} metalness={rim.metalness} roughness={rim.roughness} />
      </mesh>

      <mesh ref={liquidRef} position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius * 0.96, radius * 0.96, height, 40]} />
        <meshStandardMaterial
          color={liquidColor}
          emissive={liquidColor}
          emissiveIntensity={liquid.emissiveIntensity}
          roughness={liquid.roughness}
          metalness={liquid.metalness}
          transparent
          opacity={liquid.opacity}
        />
      </mesh>
    </group>
  );
}
