const PROCESS_3D = (() => {
  const container = document.getElementById("process-3d");
  if (!container) return null;

  let THREE = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let flows = [];
  let resizeObserver = null;

  function parseLevel(el) {
    const raw = getComputedStyle(el).getPropertyValue("--level").trim();
    const value = Number(raw);
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, value)) / 100;
    return 0.6;
  }

  function parseLiquidColor(el) {
    const raw = getComputedStyle(el).getPropertyValue("--liquid-base").trim();
    const parts = raw.split(/\s+/).map((part) => Number(part));
    if (parts.length >= 3 && parts.every((v) => Number.isFinite(v))) {
      return parts.slice(0, 3);
    }
    return [60, 160, 220];
  }

  function setupLights() {
    const ambient = new THREE.AmbientLight(0x88b5ff, 0.5);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 6, 5);
    const rim = new THREE.PointLight(0x3ed0ff, 1.2, 20);
    rim.position.set(-4, 3, 3);
    scene.add(ambient, key, rim);
  }

  function createTank({ position, radius, height, color, level }) {
    const group = new THREE.Group();
    group.position.copy(position);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x88c9ff,
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.85,
      thickness: 0.6,
      transparent: true,
      opacity: 0.35,
      clearcoat: 0.7,
    });
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 48, 1, true),
      glassMat
    );
    glass.position.y = height / 2;
    group.add(glass);

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xced9e6,
      metalness: 0.6,
      roughness: 0.2,
    });
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.01, radius * 0.06, 16, 64),
      rimMat
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = height + 0.02;
    group.add(rim);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, height * 0.08, 36),
      rimMat
    );
    base.position.y = height * 0.04;
    group.add(base);

    const liquidHeight = Math.max(0.05, height * level);
    const liquidMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(`rgb(${color[0]}, ${color[1]}, ${color[2]})`),
      emissive: new THREE.Color(`rgb(${color[0]}, ${color[1]}, ${color[2]})`),
      emissiveIntensity: 0.2,
      roughness: 0.1,
      metalness: 0.05,
      transparent: true,
      opacity: 0.75,
    });
    const liquid = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, liquidHeight, 40),
      liquidMat
    );
    liquid.position.y = liquidHeight / 2 + 0.06;
    group.add(liquid);

    group.userData.liquid = liquid;
    group.userData.height = height;

    return group;
  }

  function createPipe(curve, radius, color) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6b7f94,
      metalness: 0.6,
      roughness: 0.3,
    });
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 120, radius, 12, false),
      mat
    );
    scene.add(tube);

    const count = 90;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      offsets[i] = i / count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: new THREE.Color(`rgb(${color[0]}, ${color[1]}, ${color[2]})`),
        size: 0.08,
        transparent: true,
        opacity: 0,
      })
    );
    scene.add(points);
    return { curve, points, offsets, speed: 0.22, active: false };
  }

  function buildScene() {
    scene = new THREE.Scene();

    const width = container.clientWidth || 920;
    const height = container.clientHeight || 360;
    camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 3.4, 9);
    camera.lookAt(0, 1.2, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(1.8, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    setupLights();

    const soakEl = document.querySelector(".tank.soak");
    const freshEl = document.querySelector(".tank.small.fresh");
    const heatEl = document.querySelector(".tank.small.heat");

    const soak = createTank({
      position: new THREE.Vector3(-2.2, 0, 0),
      radius: 1.45,
      height: 2.6,
      color: parseLiquidColor(soakEl || container),
      level: parseLevel(soakEl || container),
    });
    const fresh = createTank({
      position: new THREE.Vector3(2.7, 1.2, -0.4),
      radius: 0.9,
      height: 1.5,
      color: parseLiquidColor(freshEl || container),
      level: parseLevel(freshEl || container),
    });
    const heat = createTank({
      position: new THREE.Vector3(2.7, -0.7, 0.3),
      radius: 0.9,
      height: 1.5,
      color: parseLiquidColor(heatEl || container),
      level: parseLevel(heatEl || container),
    });

    scene.add(soak, fresh, heat);

    const pipeColor = [65, 180, 255];
    flows = [
      createPipe(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.5, 1.4, 0.1),
          new THREE.Vector3(0.6, 1.4, 0.1),
          new THREE.Vector3(1.6, 1.4, 0.1),
          new THREE.Vector3(2.3, 1.4, -0.1),
        ]),
        0.08,
        pipeColor
      ),
      createPipe(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.4, 1.0, 0.2),
          new THREE.Vector3(0.8, 1.0, 0.2),
          new THREE.Vector3(2.2, 1.0, -0.2),
        ]),
        0.07,
        pipeColor
      ),
      createPipe(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.5, 0.1, 0.1),
          new THREE.Vector3(0.6, 0.1, 0.1),
          new THREE.Vector3(1.6, 0.1, 0.2),
          new THREE.Vector3(2.3, 0.1, 0.3),
        ]),
        0.08,
        pipeColor
      ),
      createPipe(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.3, -0.3, 0.2),
          new THREE.Vector3(0.9, -0.3, 0.2),
          new THREE.Vector3(2.1, -0.3, 0.3),
        ]),
        0.07,
        pipeColor
      ),
    ];
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = container.clientWidth || 920;
    const height = container.clientHeight || 360;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function animate(time) {
    if (!renderer) return;
    flows.forEach((flow) => {
      const { curve, points, offsets, speed, active } = flow;
      const positions = points.geometry.attributes.position.array;
      for (let i = 0; i < offsets.length; i += 1) {
        const t = (offsets[i] + (time * 0.0001 * speed)) % 1;
        const pos = curve.getPointAt(t);
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;
      }
      points.geometry.attributes.position.needsUpdate = true;
      points.material.opacity = active ? 0.95 : 0.0;
    });
    renderer.render(scene, camera);
  }

  function setFlow(index, on) {
    if (!flows[index]) return;
    flows[index].active = Boolean(on);
  }

  function syncFromDom() {
    document.querySelectorAll(".pipe").forEach((pipe) => {
      const idx = Number(pipe.dataset.pipe);
      if (Number.isFinite(idx)) {
        setFlow(idx, pipe.classList.contains("on"));
      }
    });
  }

  async function init() {
    try {
      THREE = await import("./three.module.js");
    } catch (err) {
      console.warn("3D disabled: failed to load THREE", err);
      return;
    }
    buildScene();
    document.body.classList.add("use-3d");
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    syncFromDom();
    renderer.setAnimationLoop(animate);
  }

  init();

  return { setFlow, syncFromDom };
})();

if (PROCESS_3D) {
  window.Process3D = PROCESS_3D;
}
