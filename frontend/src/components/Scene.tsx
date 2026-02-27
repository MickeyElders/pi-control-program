import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import FlowParticles from "./FlowParticles";
import Pipe from "./Pipe";
import Tank from "./Tank";

export type TankState = {
  level: number;
  color: [number, number, number];
};

export type FlowState = {
  pump1: boolean;
  pump2: boolean;
  pump3: boolean;
  valveFresh: boolean;
  valveHeat: boolean;
};

export type SceneProps = {
  tanks: {
    soak: TankState;
    fresh: TankState;
    heat: TankState;
  };
  flows: FlowState;
};

const PIPE_COLOR: [number, number, number] = [70, 180, 255];

export default function Scene({ tanks, flows }: SceneProps) {
  const layout = useMemo(() => {
    const soak = {
      position: new THREE.Vector3(0, -0.1, 0),
      radius: 1.2,
      height: 2.6,
    };
    const small = {
      radius: 0.7,
      height: 1.5,
    };
    const fresh = {
      position: new THREE.Vector3(3.2, 1.3, 0.2),
      ...small,
    };
    const heat = {
      position: new THREE.Vector3(3.2, -1.4, 0.2),
      ...small,
    };

    const makeCurve = (start: THREE.Vector3, end: THREE.Vector3, lift = 0.5, bow = 0.35) => {
      const mid = start.clone().lerp(end, 0.5);
      mid.y += lift;
      mid.z += bow;
      return new THREE.CatmullRomCurve3([start, mid, end]);
    };

    const soakRightUpper = new THREE.Vector3(
      soak.position.x + soak.radius,
      soak.position.y + soak.height * 0.65,
      0.4
    );
    const soakRightLower = new THREE.Vector3(
      soak.position.x + soak.radius,
      soak.position.y + soak.height * 0.3,
      0.4
    );
    const soakRightUpperOut = new THREE.Vector3(
      soak.position.x + soak.radius,
      soak.position.y + soak.height * 0.62,
      -0.4
    );
    const soakRightLowerOut = new THREE.Vector3(
      soak.position.x + soak.radius,
      soak.position.y + soak.height * 0.28,
      -0.4
    );

    const freshLeft = new THREE.Vector3(fresh.position.x - fresh.radius, fresh.position.y, 0.2);
    const heatLeft = new THREE.Vector3(heat.position.x - heat.radius, heat.position.y, 0.2);

    return {
      soak,
      fresh,
      heat,
      curves: [
        makeCurve(freshLeft, soakRightUpper, 0.55, 0.3),
        makeCurve(soakRightUpperOut, freshLeft, 0.4, -0.3),
        makeCurve(heatLeft, soakRightLower, 0.45, 0.3),
        makeCurve(soakRightLowerOut, heatLeft, 0.35, -0.3),
      ],
    };
  }, []);

  const flowStates = [
    flows.pump1,
    flows.pump3 && flows.valveFresh,
    flows.pump2,
    flows.pump3 && flows.valveHeat,
  ];

  return (
    <div className="scene-canvas">
      <Canvas camera={{ position: [0, 1.6, 8], fov: 35 }} dpr={[1, 1.8]}>
        <color attach="background" args={["#0b1222"]} />
        <ambientLight intensity={0.6} color={"#8bb7ff"} />
        <directionalLight position={[5, 8, 6]} intensity={1.1} color={"#ffffff"} />
        <pointLight position={[-6, 5, 4]} intensity={1.2} color={"#3ed0ff"} />

        <group>
          <Tank
            position={[layout.soak.position.x, layout.soak.position.y, layout.soak.position.z]}
            radius={layout.soak.radius}
            height={layout.soak.height}
            level={tanks.soak.level}
            color={tanks.soak.color}
          />
          <Tank
            position={[layout.fresh.position.x, layout.fresh.position.y, layout.fresh.position.z]}
            radius={layout.fresh.radius}
            height={layout.fresh.height}
            level={tanks.fresh.level}
            color={tanks.fresh.color}
          />
          <Tank
            position={[layout.heat.position.x, layout.heat.position.y, layout.heat.position.z]}
            radius={layout.heat.radius}
            height={layout.heat.height}
            level={tanks.heat.level}
            color={tanks.heat.color}
          />

          {layout.curves.map((curve, index) => (
            <group key={`pipe-${index}`}>
              <Pipe curve={curve} radius={0.08} color={0x6b7f94} />
              <FlowParticles
                curve={curve}
                count={140}
                speed={0.28}
                size={0.08}
                color={PIPE_COLOR}
                active={flowStates[index]}
              />
            </group>
          ))}
        </group>

        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 3.2}
          maxPolarAngle={Math.PI / 2.2}
          target={[1.2, 0.6, 0]}
        />
      </Canvas>
    </div>
  );
}
