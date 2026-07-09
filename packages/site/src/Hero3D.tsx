import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Hero scene: a dense, tangled cloud of agent-execution nodes on the left that
 * resolves into a clean vertical "optimized" spine on the right — the product
 * thesis rendered in 3D. Slow rotation + subtle mouse parallax; static when the
 * viewer prefers reduced motion.
 */
export function Hero3D() {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const INDIGO = new THREE.Color('#7c5cff');
    const CYAN = new THREE.Color('#35d3e6');

    // --- nodes ---
    const chaos: THREE.Vector3[] = [];
    for (let i = 0; i < 72; i++) {
      chaos.push(new THREE.Vector3(-1.6 - Math.random() * 2.2, (Math.random() - 0.5) * 4.2, (Math.random() - 0.5) * 3));
    }
    const spine: THREE.Vector3[] = [];
    const spineN = 7;
    for (let i = 0; i < spineN; i++) {
      spine.push(new THREE.Vector3(2.1, 1.7 - (i / (spineN - 1)) * 3.4, 0));
    }
    const all = [...chaos, ...spine];

    const posArr = new Float32Array(all.length * 3);
    const colArr = new Float32Array(all.length * 3);
    all.forEach((v, i) => {
      posArr.set([v.x, v.y, v.z], i * 3);
      const c = i < chaos.length ? INDIGO : CYAN;
      colArr.set([c.r, c.g, c.b], i * 3);
    });
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    ptGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    const points = new THREE.Points(
      ptGeo,
      new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true }),
    );

    // --- tangled edges (chaos → nearest neighbours) ---
    const chaosSeg: number[] = [];
    for (let i = 0; i < chaos.length; i++) {
      const near = chaos
        .map((v, j) => ({ j, d: chaos[i].distanceTo(v) }))
        .filter((x) => x.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const n of near) chaosSeg.push(chaos[i].x, chaos[i].y, chaos[i].z, chaos[n.j].x, chaos[n.j].y, chaos[n.j].z);
    }
    // a few chaos nodes feed into the top of the spine (the "planner")
    for (let i = 0; i < 5; i++) {
      const c = chaos[Math.floor(Math.random() * chaos.length)];
      chaosSeg.push(c.x, c.y, c.z, spine[0].x, spine[0].y, spine[0].z);
    }
    const chaosLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(chaosSeg, 3)),
      new THREE.LineBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.14 }),
    );

    // --- clean spine edges ---
    const spineSeg: number[] = [];
    for (let i = 0; i < spine.length - 1; i++) {
      spineSeg.push(spine[i].x, spine[i].y, spine[i].z, spine[i + 1].x, spine[i + 1].y, spine[i + 1].z);
    }
    const spineLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(spineSeg, 3)),
      new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.75 }),
    );

    const group = new THREE.Group();
    group.add(points, chaosLines, spineLines);
    group.rotation.y = -0.35;
    scene.add(group);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let mx = 0, my = 0;
    const onMove = (e: MouseEvent) => {
      mx = (e.clientX / window.innerWidth - 0.5) * 0.5;
      my = (e.clientY / window.innerHeight - 0.5) * 0.3;
    };
    if (!reduce) window.addEventListener('mousemove', onMove);

    const onResize = () => {
      if (!el) return;
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('resize', onResize);

    let raf = 0;
    let t = 0;
    const render = () => {
      t += 0.005;
      group.rotation.y = -0.35 + Math.sin(t * 0.5) * 0.28 + mx;
      group.rotation.x = Math.sin(t * 0.35) * 0.08 + my;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    if (reduce) renderer.render(scene, camera);
    else raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      ptGeo.dispose();
      chaosLines.geometry.dispose();
      spineLines.geometry.dispose();
      (points.material as THREE.Material).dispose();
      (chaosLines.material as THREE.Material).dispose();
      (spineLines.material as THREE.Material).dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, []);

  return <div className="hero-canvas" ref={mount} aria-hidden="true" />;
}
