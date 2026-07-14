/* =============================================================================
 * particle-scene.js
 * -----------------------------------------------------------------------------
 * Token Music Box - Voxel Planet
 *
 * 90×90 InstancedMesh voxel terrain on a sphere-curved plane.
 * Simplex noise base + bass waves + mid bumps. Height-based color gradient.
 * Central cyan ring pulses with beats. OrbitControls + UnrealBloom.
 * ========================================================================== */

(function (global) {
  'use strict';

  var GRID = 90;
  var VOXEL_SIZE = 0.8;
  var SPACING = 1.0;
  var RING_RADIUS = 12;
  var RING_WIDTH = 2.0;
  var STAR_COUNT = 600;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---- Simplex noise (compact implementation) ----
  var perm = new Uint8Array(512);
  (function () {
    var p = new Uint8Array(256);
    for (var i = 0; i < 256; i++) p[i] = i;
    for (var i = 255; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (var i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  function grad2(hash, x, y) {
    var h = hash & 7;
    var u = h < 4 ? x : y;
    var v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }

  function simplex2(xin, yin) {
    var F2 = 0.5 * (Math.sqrt(3) - 1);
    var G2 = (3 - Math.sqrt(3)) / 6;
    var s = (xin + yin) * F2;
    var i = Math.floor(xin + s);
    var j = Math.floor(yin + s);
    var t = (i + j) * G2;
    var X0 = i - t, Y0 = j - t;
    var x0 = xin - X0, y0 = yin - Y0;
    var i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    var x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    var ii = i & 255, jj = j & 255;
    var gi0 = perm[ii + perm[jj]];
    var gi1 = perm[ii + i1 + perm[jj + j1]];
    var gi2 = perm[ii + 1 + perm[jj + 1]];
    var n0 = 0, n1 = 0, n2 = 0;
    var t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * grad2(gi0, x0, y0); }
    var t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * grad2(gi1, x1, y1); }
    var t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * grad2(gi2, x2, y2); }
    return 70 * (n0 + n1 + n2);
  }

  // ---- Color gradient: low #2a2f55 -> mid #6a5acd -> high #d98cc9 ----
  var COL_LOW = [0x2a / 255, 0x2f / 255, 0x55 / 255];
  var COL_MID = [0x6a / 255, 0x5a / 255, 0xcd / 255];
  var COL_HIGH = [0xd9 / 255, 0x8c / 255, 0xc9 / 255];
  var COL_RING = [0x7f / 255, 0xf4 / 255, 0xe8 / 255];

  function heightColor(h, isRing) {
    if (isRing) return COL_RING;
    var t = clamp01(h);
    var r, g, b;
    if (t < 0.5) {
      var k = t / 0.5;
      r = lerp(COL_LOW[0], COL_MID[0], k);
      g = lerp(COL_LOW[1], COL_MID[1], k);
      b = lerp(COL_LOW[2], COL_MID[2], k);
    } else {
      var k2 = (t - 0.5) / 0.5;
      r = lerp(COL_MID[0], COL_HIGH[0], k2);
      g = lerp(COL_MID[1], COL_HIGH[1], k2);
      b = lerp(COL_MID[2], COL_HIGH[2], k2);
    }
    return [r, g, b];
  }

  function ParticleScene(container) {
    if (typeof THREE === 'undefined') throw new Error('THREE not found');
    this.container = container;

    var w = container.clientWidth || window.innerWidth;
    var h = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070f);
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.010);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
    this.camera.position.set(0, 42, 60);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // OrbitControls
    if (typeof THREE.OrbitControls !== 'undefined') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.minDistance = 40;
      this.controls.maxDistance = 90;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.5; // ~0.5°/s
      this.controls.target.set(0, 0, 0);
    }

    // Post-processing: UnrealBloom
    this._initBloom(w, h);

    // State
    this._clock = new THREE.Clock();
    this._tokenLevel = 0;
    this._beatDecay = 0;
    this._bassSmoothed = 0;
    this._midSmoothed = 0;
    this._trebleSmoothed = 0;
    this._energySmoothed = 0;
    this._ringPulse = 0;
    this._noiseOffsetX = Math.random() * 1000;
    this._noiseOffsetZ = Math.random() * 1000;
    this.currentForm = 'wave';

    this._buildVoxels();
    this._buildStars();

    this._animate = this._animate.bind(this);
    this._animate();
  }

  ParticleScene.prototype._initBloom = function (w, h) {
    if (typeof THREE.EffectComposer === 'undefined') return;
    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
    this.bloomPass = new THREE.UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.9,  // strength
      0.6,  // radius
      0.4   // threshold
    );
    this.composer.addPass(this.bloomPass);
  };

  // ---- Voxel terrain: single InstancedMesh ----
  ParticleScene.prototype._buildVoxels = function () {
    var count = GRID * GRID;
    var geo = new THREE.BoxGeometry(VOXEL_SIZE, 1, VOXEL_SIZE);
    // Move pivot to bottom so scaling goes upward
    geo.translate(0, 0.5, 0);

    var mat = new THREE.MeshStandardMaterial({
      vertexColors: false,
      roughness: 0.4,
      metalness: 0.3,
    });

    this.voxels = new THREE.InstancedMesh(geo, mat, count);
    this.voxels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Per-instance color
    this.voxelColors = new Float32Array(count * 3);
    this.voxels.instanceColor = new THREE.InstancedBufferAttribute(this.voxelColors, 3);
    this.voxels.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Store grid positions for height calculation
    this.gridPositions = new Float32Array(count * 2); // x, z in grid space
    this.gridDistFromCenter = new Float32Array(count);
    this.gridIsRing = new Uint8Array(count);
    this.gridIsRingInterior = new Uint8Array(count);

    var halfGrid = (GRID - 1) * SPACING / 2;
    for (var j = 0; j < GRID; j++) {
      for (var i = 0; i < GRID; i++) {
        var idx = j * GRID + i;
        var wx = i * SPACING - halfGrid;
        var wz = j * SPACING - halfGrid;
        this.gridPositions[idx * 2] = wx;
        this.gridPositions[idx * 2 + 1] = wz;
        var dist = Math.sqrt(wx * wx + wz * wz);
        this.gridDistFromCenter[idx] = dist;
        // Ring: distance within [RING_RADIUS - RING_WIDTH/2, RING_RADIUS + RING_WIDTH/2]
        var ringHalf = RING_WIDTH / 2;
        this.gridIsRing[idx] = (dist >= RING_RADIUS - ringHalf && dist <= RING_RADIUS + ringHalf) ? 1 : 0;
        // Interior: inside ring but not ring itself (for crater dip)
        this.gridIsRingInterior[idx] = (dist < RING_RADIUS - ringHalf && dist > RING_RADIUS - ringHalf - 4) ? 1 : 0;
      }
    }

    this.scene.add(this.voxels);

    // Lights
    var ambient = new THREE.AmbientLight(0x3a3a5a, 0.5);
    this.scene.add(ambient);
    var dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(20, 40, 20);
    this.scene.add(dir);
    var pointCyan = new THREE.PointLight(0x7ff4e8, 2, 50);
    pointCyan.position.set(0, 8, 0);
    this.scene.add(pointCyan);
    this.ringLight = pointCyan;
  };

  // ---- Stars ----
  ParticleScene.prototype._buildStars = function () {
    var geo = new THREE.BufferGeometry();
    var positions = new Float32Array(STAR_COUNT * 3);
    var phases = new Float32Array(STAR_COUNT);
    for (var i = 0; i < STAR_COUNT; i++) {
      // Upper hemisphere sphere distribution
      var theta = Math.random() * Math.PI * 2;
      var phi = Math.random() * Math.PI * 0.45 + 0.05; // upper area
      var r = 120 + Math.random() * 60;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) + 20;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      phases[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    var starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: [
        'precision mediump float;',
        'attribute float aPhase;',
        'varying float vBright;',
        'uniform float uTime;',
        'void main() {',
        '  vBright = 0.3 + 0.7 * sin(uTime * 2.0 + aPhase * 6.28);',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  gl_PointSize = 1.5;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision mediump float;',
        'varying float vBright;',
        'void main() {',
        '  vec2 uv = gl_PointCoord - 0.5;',
        '  float d = length(uv);',
        '  if (d > 0.5) discard;',
        '  float a = smoothstep(0.5, 0.0, d) * vBright;',
        '  gl_FragColor = vec4(0.8, 0.85, 1.0, a * 0.8);',
        '}',
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.stars = new THREE.Points(geo, starMat);
    this.starMat = starMat;
    this.scene.add(this.stars);
  };

  ParticleScene.prototype.setForm = function (formName) {
    this.currentForm = formName || 'wave';
  };

  ParticleScene.prototype.setTokenLevel = function (level) {
    this._tokenLevel = clamp01(level);
  };

  // ---- Main update: compute heights, colors, transform instances ----
  var _dummy = new THREE.Object3D();
  var _color = new THREE.Color();

  ParticleScene.prototype.update = function (audioData, tokenData) {
    var a = audioData || {};
    var bass = clamp01(a.bass || 0);
    var mid = clamp01(a.mid || a.mids || 0);
    var treble = clamp01(a.treble || 0);
    var beat = clamp01(a.beat || 0);
    var energy = clamp01(a.energy || 0);

    this._bassSmoothed = lerp(this._bassSmoothed, bass, 0.08);
    this._midSmoothed = lerp(this._midSmoothed, mid, 0.12);
    this._trebleSmoothed = lerp(this._trebleSmoothed, treble, 0.18);
    this._energySmoothed = lerp(this._energySmoothed, energy, 0.05);

    if (tokenData && tokenData.peak > 0) {
      var target = clamp01(tokenData.consumed / tokenData.peak);
      this._tokenLevel = lerp(this._tokenLevel, target, 0.03);
    }

    var now = this._clock.getElapsedTime();

    // Beat detection
    if (beat > 0.5) {
      this._beatDecay = 1.0;
      this._ringPulse = 1.0;
    }
    this._beatDecay *= 0.88;
    this._ringPulse *= 0.92;

    var t = now;
    var bassS = this._bassSmoothed;
    var midS = this._midSmoothed;
    var trebleS = this._trebleSmoothed;
    var energyS = this._energySmoothed;
    var ringPulse = this._ringPulse;

    // Update each voxel
    var count = GRID * GRID;
    var noiseOffX = this._noiseOffsetX;
    var noiseOffZ = this._noiseOffsetZ;

    for (var idx = 0; idx < count; idx++) {
      var wx = this.gridPositions[idx * 2];
      var wz = this.gridPositions[idx * 2 + 1];
      var dist = this.gridDistFromCenter[idx];
      var isRing = this.gridIsRing[idx];
      var isRingInterior = this.gridIsRingInterior[idx];

      // Simplex noise base (amplitude 3)
      var nx = (wx + noiseOffX) * 0.06;
      var nz = (wz + noiseOffZ) * 0.06;
      var noise = simplex2(nx, nz) * 1.5;
      noise += simplex2(nx * 2, nz * 2) * 0.5;
      var baseH = noise * 3; // amplitude 3

      // Bass wave: radiating outward, amplitude ×6
      var r = dist;
      var bassWave = Math.sin(r * 0.3 - t * 1.5) * bassS * 6;

      // Mid: local bump
      var midBump = Math.sin(wx * 0.15 + t * 0.8) * Math.cos(wz * 0.15 - t * 0.6) * midS * 2;

      // Treble: fine jitter
      var trebleJitter = Math.sin(wx * 0.5 + wz * 0.3 + t * 3) * trebleS * 0.5;

      var height = baseH + bassWave + midBump + trebleJitter;

      // Ring: clear elevated ring, pulses with beat (scale expansion + rebound)
      if (isRing) {
        var ringExpand = 1.0 + ringPulse * 0.15; // 1.0 -> 1.15
        var ringH = 5 * ringExpand + Math.sin(t * 2 + r * 0.5) * 0.3;
        height = ringH;
      }

      // Ring interior: crater dip, slightly lit
      if (isRingInterior) {
        height = -1.5 + Math.sin(t * 1.5 + r) * 0.2;
      }

      // Sphere curvature: edges droop down
      var sphereY = -dist * dist * 0.012;

      // Apply: position + scale (box height = height)
      _dummy.position.set(wx, sphereY, wz);
      _dummy.scale.set(1, Math.max(0.1, height), 1);
      _dummy.updateMatrix();
      this.voxels.setMatrixAt(idx, _dummy.matrix);

      // Color by height
      var normH = clamp01((height + 3) / 12); // normalize -3..9 to 0..1
      var col = heightColor(normH, isRing);

      // Ring pulse: boost brightness
      if (isRing) {
        var ringBoost = 0.6 + ringPulse * 0.5 + energyS * 0.3;
        col = [col[0] * ringBoost, col[1] * ringBoost, col[2] * ringBoost];
      } else if (isRingInterior) {
        // Interior: dim cyan-tinted glow
        col = [COL_RING[0] * 0.2, COL_RING[1] * 0.2, COL_RING[2] * 0.25];
      } else {
        // Emissive boost with height
        var emBoost = 0.3 + normH * 0.5 + energyS * 0.2;
        col = [col[0] * emBoost, col[1] * emBoost, col[2] * emBoost];
      }

      _color.setRGB(col[0], col[1], col[2]);
      this.voxels.setColorAt(idx, _color);
    }

    this.voxels.instanceMatrix.needsUpdate = true;
    this.voxels.instanceColor.needsUpdate = true;

    // Ring light pulse
    if (this.ringLight) {
      this.ringLight.intensity = 1.5 + ringPulse * 3 + energyS * 1;
    }

    // Stars twinkle
    if (this.starMat) {
      this.starMat.uniforms.uTime.value = now;
    }

    // Slow noise drift
    this._noiseOffsetX += 0.005;
    this._noiseOffsetZ += 0.003;

    // Update controls
    if (this.controls) {
      this.controls.update();
    }
  };

  ParticleScene.prototype._animate = function () {
    this._rafId = requestAnimationFrame(this._animate);
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };

  ParticleScene.prototype.resize = function () {
    var w = this.container.clientWidth || window.innerWidth;
    var h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  };

  ParticleScene.prototype.dispose = function () {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.voxels) { this.voxels.geometry.dispose(); this.voxels.material.dispose(); }
    if (this.stars) { this.stars.geometry.dispose(); this.starMat.dispose(); }
    if (this.controls) this.controls.dispose();
    if (this.renderer) this.renderer.dispose();
    if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode)
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  };

  global.ParticleScene = ParticleScene;
})(typeof window !== 'undefined' ? window : this);
