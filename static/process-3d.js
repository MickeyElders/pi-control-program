const PROCESS_3D = (() => {
  const container = document.getElementById("process-3d");
  if (!container) return null;

  let THREE = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let flows = [];
  let pipeGroup = null;
  let resizeObserver = null;
  const tankGroups = {};

  const tankMap = {
    soak: {
      tank: ".tank.soak",
      body: ".tank.soak .tank-body",
    },
    fresh: {
      tank: ".tank.small.fresh",
      body: ".tank.small.fresh .tank-body",
    },
    heat: {
      tank: ".tank.small.heat",
      body: ".tank.small.heat .tank-body",
    },
  };

  function parseLevel(el) {
    if (!el) return 0.6;
    const raw = getComputedStyle(el).getPropertyValue("--level").trim();
    const value = Number(raw);
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, value)) / 100;
    return 0.6;
  }

  function parseLiquidColor(el) {
    if (!el) return [60, 160, 220];
    const raw = getComputedStyle(el).getPropertyValue("--liquid-base").trim();
    const parts = raw.split(/\s+/).map((part) => Number(part));
    if (parts.length >= 3 && parts.every((v) => Number.isFinite(v))) {
      return parts.slice(0, 3);
    }
    return [60, 160, 220];
  }

  function setupLights() {
    const ambient = new THREE.AmbientLight(0x88b5ff, 0.55);
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(2, 6, 6);
    const rim = new THREE.PointLight(0x3ed0ff, 1.2, 2000);
    rim.position.set(-200, 180, 400);
    scene.add(ambient, key, rim);
  }

  function createTank({ color, level }) {
    const group = new THREE.Group();
    const radius = 0.5;
    const height = 1.0;

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x90cfff,
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.88,
      thickness: 0.6,
      transparent: true,
      opacity: 0.32,
      clearcoat: 0.8,
      ior: 1.2,
    });
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 48, 1, true),
      glassMat
    );
    glass.position.y = height / 2;
    group.add(glass);

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xd4dde8,
      metalness: 0.7,
      roughness: 0.2,
    });
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.02, radius * 0.07, 16, 64),
      rimMat
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = height + 0.02;
    group.add(rim);

    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.98, radius * 0.98, height * 0.04, 48),
      rimMat
    );
    lid.position.y = height + 0.04;
    group.add(lid);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, height * 0.08, 36),
      rimMat
    );
    base.position.y = height * 0.04;
    group.add(base);

    const liquidMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(`rgb(${color[0]}, ${color[1]}, ${color[2]})`),
      emissive: new THREE.Color(`rgb(${color[0]}, ${color[1]}, ${color[2]})`),
      emissiveIntensity: 0.25,
      roughness: 0.08,
      metalness: 0.05,
      transparent: true,
      opacity: 0.78,
    });
    const liquid = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, 1, 40),
      liquidMat
    );
    group.add(liquid);

    group.userData.liquid = liquid;
    group.userData.height = height;
    group.userData.radius = radius;
    updateTankLevel(group, level);
    return group;
  }

  function updateTankLevel(group, level) {
    const clamped = Math.max(0.05, Math.min(1, level));
    const liquid = group.userData.liquid;
    liquid.scale.y = clamped;
    liquid.position.y = clamped / 2 + 0.04;
  }

  function updateTankColor(group, color) {
    const liquid = group.userData.liquid;
    const normalized = color.map((v) => v / 255);
    liquid.material.color.setRGB(normalized[0], normalized[1], normalized[2]);
    liquid.material.emissive.setRGB(normalized[0], normalized[1], normalized[2]);
  }

  function createPipe(curve, radius, color) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6b7f94,
      metalness: 0.6,
      roughness: 0.35,
    });
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 120, radius, 12, false),
      mat
    );
    pipeGroup.add(tube);

    const count = 120;
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
        size: radius * 1.2,
        transparent: true,
        opacity: 0,
      })
    );
    pipeGroup.add(points);
    return { curve, points, offsets, speed: 0.25, active: false };
  }

  function getCameraDistance(height, fov) {
    const radians = THREE.MathUtils.degToRad(fov / 2);
    return (height / 2) / Math.tan(radians);
  }

  function buildScene() {
    scene = new THREE.Scene();
    pipeGroup = new THREE.Group();
    scene.add(pipeGroup);

    const width = container.clientWidth || 920;
    const height = container.clientHeight || 360;
    const fov = 32;
    camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 5000);
    const distance = getCameraDistance(height, fov);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(1.8, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.physicallyCorrectLights = true;
    container.appendChild(renderer.domElement);

    setupLights();

    Object.keys(tankMap).forEach((key) => {
      const tankEl = document.querySelector(tankMap[key].tank);
      const tank = createTank({
        color: parseLiquidColor(tankEl),
        level: parseLevel(tankEl),
      });
      tankGroups[key] = tank;
      scene.add(tank);
    });

    syncLayout();
    syncFromDom();
  }

  function syncLayout() {
    const containerRect = container.getBoundingClientRect();
    Object.keys(tankMap).forEach((key) => {
      const group = tankGroups[key];
      const body = document.querySelector(tankMap[key].body);
      if (!group || !body) return;
      const rect = body.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const centerX = rect.left + rect.width / 2 - containerRect.left - containerRect.width / 2;
      const bottomY = rect.bottom - containerRect.top;
      const y = containerRect.height / 2 - bottomY;
      group.position.set(centerX, y, 0);
      group.scale.set(width, height, width);
      group.rotation.y = -0.12;
      group.rotation.x = 0.05;
    });

    rebuildPipes(containerRect);
  }

  function rebuildPipes(containerRect) {
    flows = [];
    if (!pipeGroup) return;
    while (pipeGroup.children.length) {
      const child = pipeGroup.children.pop();
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }

    const pipeColor = [65, 180, 255];
    document.querySelectorAll(".pipe").forEach((pipeEl) => {
      const idx = Number(pipeEl.dataset.pipe);
      const rect = pipeEl.getBoundingClientRect();
      if (!Number.isFinite(idx)) return;
      const startX = rect.left - containerRect.left - containerRect.width / 2;
      const endX = rect.right - containerRect.left - containerRect.width / 2;
      const midX = (startX + endX) / 2;
      const centerY = rect.top + rect.height / 2 - containerRect.top;
      const y = containerRect.height / 2 - centerY;
      const z = idx % 2 === 0 ? 6 : -6;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(startX, y, z),
        new THREE.Vector3(midX, y + 6, z),
        new THREE.Vector3(endX, y, z),
      ]);
      const radius = Math.max(2.2, rect.height * 0.35);
      flows[idx] = createPipe(curve, radius, pipeColor);
    });
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = container.clientWidth || 920;
    const height = container.clientHeight || 360;
    camera.aspect = width / height;
    const distance = getCameraDistance(height, camera.fov);
    camera.position.set(0, 0, distance);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    syncLayout();
    syncFromDom();
  }

  function animate(time) {
    if (!renderer) return;
    flows.forEach((flow) => {
      if (!flow) return;
      const { curve, points, offsets, speed, active } = flow;
      const positions = points.geometry.attributes.position.array;
      for (let i = 0; i < offsets.length; i += 1) {
        const t = (offsets[i] + (time * 0.00006 * speed)) % 1;
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
    Object.keys(tankMap).forEach((key) => {
      const tankEl = document.querySelector(tankMap[key].tank);
      const group = tankGroups[key];
      if (!tankEl || !group) return;
      updateTankLevel(group, parseLevel(tankEl));
      updateTankColor(group, parseLiquidColor(tankEl));
    });

    document.querySelectorAll(".pipe").forEach((pipeEl) => {
      const idx = Number(pipeEl.dataset.pipe);
      if (!Number.isFinite(idx)) return;
      setFlow(idx, pipeEl.classList.contains("on"));
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
    renderer.setAnimationLoop(animate);
  }

  init();

  return { setFlow, syncFromDom };
})();

if (PROCESS_3D) {
  window.Process3D = PROCESS_3D;
}
