/**
 * ============================================================================
 *  scene3d.js — WebGL hero scene
 * ============================================================================
 *  A slowly rotating barber pole flanked by drifting brass particles, lit by
 *  a key light that follows the pointer.
 *
 *  Loaded dynamically by main.js, and only when:
 *    • the browser reports WebGL support, and
 *    • the user has not asked for reduced motion, and
 *    • the device is not a low-memory phone.
 *  Otherwise the hero falls back to its CSS gradient, which already looks
 *  finished on its own.
 *
 *  Performance notes:
 *    • Pixel ratio is capped at 2 — beyond that the cost triples for no
 *      visible gain on a scene this simple.
 *    • The loop pauses via IntersectionObserver once the hero scrolls away,
 *      so no GPU time is burnt rendering a section nobody is looking at.
 *    • All geometries/materials are disposed in destroy().
 * ============================================================================
 */

import * as THREE from 'three';

/* ---------------------------------------------------------------------------
   Tunables — everything art-directable lives here
   --------------------------------------------------------------------------- */
const CONFIG = {
  particleCount: 900,
  particleSpread: 26,
  poleHeight: 7.2,
  poleRadius: 1.05,
  stripeCount: 9,
  rotationSpeed: 0.22,   // radians/second
  parallaxStrength: 0.6, // how far the camera leans toward the pointer
  colors: {
    brass: 0xd9a441,
    brassLight: 0xf0c274,
    cream: 0xf5f2ec,
    deep: 0x08090c,
  },
};

export class HeroScene {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();

    // Pointer position in normalised device coords (-1..1), lerped for smoothness.
    this.pointer = { x: 0, y: 0 };
    this.pointerTarget = { x: 0, y: 0 };

    this.running = false;
    this.frameId = null;
    this.disposables = [];   // Everything needing an explicit .dispose()

    // Own time accumulator rather than Clock.elapsedTime: Clock.start() resets
    // elapsed to zero, so relying on it would make the pole's bob and the
    // particle drift jump every time the hero scrolls back into view.
    this.time = 0;

    this.#initRenderer();
    this.#initScene();
    this.#buildPole();
    this.#buildParticles();
    this.#buildFloorGlow();
    this.#initLights();
    this.#bindEvents();
  }

  /* =========================================================================
     Setup
     ========================================================================= */

  #initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });

    // Cap DPR: retina phones report 3, which costs 9× the fragments for a
    // difference nobody can see on a scene made of soft gradients.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
  }

  #initScene() {
    this.scene = new THREE.Scene();
    // Fog hides the far edge of the particle field so it reads as depth
    // rather than as a box of dots.
    this.scene.fog = new THREE.FogExp2(CONFIG.colors.deep, 0.045);

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      120
    );
    this.camera.position.set(0, 0.4, 15);

    // The pole and its glow live in one group so they lean together.
    this.group = new THREE.Group();
    this.scene.add(this.group);
  }

  /**
   * The barber pole: a cylinder wearing a procedurally-drawn stripe texture.
   *
   * The classic spiral is faked by drawing diagonal stripes on a canvas and
   * scrolling the texture's `offset.y` every frame — far cheaper than
   * modelling a real helix, and visually identical at this distance.
   */
  #buildPole() {
    const stripeTex = this.#makeStripeTexture();
    this.stripeTexture = stripeTex;

    const bodyGeo = new THREE.CylinderGeometry(
      CONFIG.poleRadius, CONFIG.poleRadius, CONFIG.poleHeight, 64, 1, true
    );
    const bodyMat = new THREE.MeshStandardMaterial({
      map: stripeTex,
      roughness: 0.28,
      metalness: 0.15,
    });

    this.pole = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(this.pole);
    this.disposables.push(bodyGeo, bodyMat, stripeTex);

    // Glass sleeve — a slightly larger transparent cylinder gives the pole
    // its characteristic specular highlight down one side.
    const glassGeo = new THREE.CylinderGeometry(
      CONFIG.poleRadius * 1.06, CONFIG.poleRadius * 1.06, CONFIG.poleHeight, 64, 1, true
    );
    const glassMat = new THREE.MeshPhysicalMaterial({
      transparent: true,
      opacity: 0.16,
      roughness: 0.05,
      metalness: 0,
      transmission: 0.6,
      side: THREE.DoubleSide,
    });
    this.group.add(new THREE.Mesh(glassGeo, glassMat));
    this.disposables.push(glassGeo, glassMat);

    // Brass caps top and bottom.
    const capGeo = new THREE.SphereGeometry(CONFIG.poleRadius * 1.22, 48, 24);
    const capMat = new THREE.MeshStandardMaterial({
      color: CONFIG.colors.brass,
      roughness: 0.22,
      metalness: 0.95,
    });
    this.disposables.push(capGeo, capMat);

    for (const dir of [1, -1]) {
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = dir * (CONFIG.poleHeight / 2 + 0.1);
      cap.scale.y = 0.62;                       // Squash into a dome
      this.group.add(cap);
    }

    // Thin brass rings just inside each cap.
    const ringGeo = new THREE.TorusGeometry(CONFIG.poleRadius * 1.08, 0.07, 16, 64);
    this.disposables.push(ringGeo);
    for (const dir of [1, -1]) {
      const ring = new THREE.Mesh(ringGeo, capMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = dir * (CONFIG.poleHeight / 2 - 0.12);
      this.group.add(ring);
    }
  }

  /**
   * Draws the diagonal stripe pattern to an offscreen canvas and wraps it as
   * a repeating texture. Done at runtime so there is no image to download.
   */
  #makeStripeTexture() {
    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');

    ctx.fillStyle = '#f5f2ec';
    ctx.fillRect(0, 0, size, size);

    // Rotate the whole context so the stripes come out diagonal, then draw
    // bands wide enough to still cover the canvas corners after rotation.
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 5);
    ctx.translate(-size, -size);

    const band = (size * 2) / CONFIG.stripeCount;
    for (let i = 0; i < CONFIG.stripeCount * 2; i++) {
      // Alternate brass and deep charcoal, leaving cream gaps between pairs.
      ctx.fillStyle = i % 2 === 0 ? '#d9a441' : '#191d26';
      ctx.fillRect(0, i * band, size * 2, band * 0.44);
    }
    ctx.restore();

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 2.4);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  /**
   * Particle field. One BufferGeometry with a single Points draw call —
   * 900 individual meshes would be 900 draw calls and would stutter.
   */
  #buildParticles() {
    const { particleCount: n, particleSpread: spread } = CONFIG;

    const positions = new Float32Array(n * 3);
    // Per-particle phase offset, kept CPU-side so the shader stays trivial.
    this.driftSeeds = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread - 4;
      this.driftSeeds[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: CONFIG.colors.brassLight,
      size: 0.06,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,                    // Stops particles punching holes in each other
      blending: THREE.AdditiveBlending,     // Overlaps glow instead of flattening
      map: this.#makeDotTexture(),
    });

    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
    this.disposables.push(geo, mat, mat.map);

    // Cache the raw array — mutated every frame in #animateParticles().
    this.particlePositions = positions;
  }

  /** A soft radial dot, so particles are round rather than hard squares. */
  #makeDotTexture() {
    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');

    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    return new THREE.CanvasTexture(cv);
  }

  /** A wide, dim disc under the pole that reads as a pool of floor light. */
  #buildFloorGlow() {
    const geo = new THREE.CircleGeometry(9, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: CONFIG.colors.brass,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -CONFIG.poleHeight / 2 - 1.2;

    this.scene.add(disc);
    this.disposables.push(geo, mat);
  }

  #initLights() {
    // Ambient keeps the dark side of the pole from going pure black.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    // Key light — repositioned each frame to follow the pointer.
    this.keyLight = new THREE.PointLight(CONFIG.colors.brassLight, 42, 40, 2);
    this.keyLight.position.set(4, 5, 7);
    this.scene.add(this.keyLight);

    // Cool rim light on the opposite side separates the pole from the fog.
    const rim = new THREE.DirectionalLight(0x8ab4ff, 0.7);
    rim.position.set(-6, 2, -5);
    this.scene.add(rim);

    // Warm bounce from below, mimicking the floor glow.
    const bounce = new THREE.PointLight(CONFIG.colors.brass, 12, 22, 2);
    bounce.position.set(0, -5, 3);
    this.scene.add(bounce);
  }

  /* =========================================================================
     Events
     ========================================================================= */

  #bindEvents() {
    // Bound once and stored, so removeEventListener works in destroy().
    this._onResize = this.#onResize.bind(this);
    this._onPointer = this.#onPointerMove.bind(this);

    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('pointermove', this._onPointer, { passive: true });

    // Pause rendering when the hero leaves the viewport, and when the tab
    // is backgrounded. Both are pure battery savings.
    this.observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? this.start() : this.stop()),
      { threshold: 0.01 }
    );
    this.observer.observe(this.canvas);

    this._onVisibility = () => (document.hidden ? this.stop() : this.start());
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  #onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  #onPointerMove(e) {
    // Store the target only; #tick() eases toward it, which turns a jittery
    // mouse trail into a smooth glide.
    this.pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointerTarget.y = -((e.clientY / window.innerHeight) * 2 - 1);
  }

  /* =========================================================================
     Loop
     ========================================================================= */

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.#tick();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.clock.stop();
  }

  #tick = () => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.#tick);

    // Clamp dt so a backgrounded tab does not resume with one enormous step.
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    const t = this.time;

    // Ease the pointer toward its target (simple exponential smoothing).
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * 0.05;
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * 0.05;

    // Pole: constant spin, plus a lean toward the cursor and a slow bob.
    this.pole.rotation.y += CONFIG.rotationSpeed * dt;
    this.stripeTexture.offset.y -= dt * 0.16;   // Scrolls the spiral upward

    this.group.rotation.z = this.pointer.x * 0.07;
    this.group.rotation.x = -this.pointer.y * 0.05;
    this.group.position.y = Math.sin(t * 0.5) * 0.14;

    this.#animateParticles(t);

    // Key light orbits with the pointer, so highlights track the cursor.
    this.keyLight.position.x = this.pointer.x * 8 + Math.sin(t * 0.3) * 2;
    this.keyLight.position.y = this.pointer.y * 5 + 4;

    // Camera parallax — subtle, or it induces motion sickness.
    this.camera.position.x += (this.pointer.x * CONFIG.parallaxStrength - this.camera.position.x) * 0.04;
    this.camera.position.y += (this.pointer.y * CONFIG.parallaxStrength * 0.6 + 0.4 - this.camera.position.y) * 0.04;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Drifts every particle upward with a lateral sine wobble, wrapping any
   * that rise past the top back to the bottom so the field never empties.
   *
   * Writing straight into the typed array and flagging needsUpdate once is
   * the cheap way to do this — a per-particle Object3D would be far slower.
   */
  #animateParticles(t) {
    const pos = this.particlePositions;
    const limit = CONFIG.particleSpread * 0.4;

    for (let i = 0; i < CONFIG.particleCount; i++) {
      const i3 = i * 3;
      const seed = this.driftSeeds[i];

      pos[i3 + 1] += 0.004 + Math.sin(seed) * 0.002;          // Rise
      pos[i3]     += Math.sin(t * 0.4 + seed) * 0.0025;       // Wobble

      if (pos[i3 + 1] > limit) {
        pos[i3 + 1] = -limit;                                  // Wrap around
        pos[i3] = (Math.random() - 0.5) * CONFIG.particleSpread;
      }
    }

    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.rotation.y = t * 0.012;
  }

  /* =========================================================================
     Teardown — called if the scene is ever swapped out
     ========================================================================= */

  destroy() {
    this.stop();

    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onPointer);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.observer?.disconnect();

    // GPU memory is not garbage collected — each resource must be released.
    this.disposables.forEach((d) => d?.dispose?.());
    this.renderer.dispose();
  }
}

/**
 * Feature-detects WebGL by actually asking for a context. Checking for the
 * WebGLRenderingContext constructor is not enough — plenty of machines have
 * the API present but the driver blocklisted.
 *
 * @returns {boolean}
 */
export function supportsWebGL() {
  try {
    const cv = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
              (cv.getContext('webgl2') || cv.getContext('webgl')));
  } catch {
    return false;
  }
}
