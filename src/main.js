import './style.css'
import * as THREE from 'three';

// --- Configuration ---
const CONFIG = {
  gridSpacing: 40,
  gridSize: 3000,
  lineResolution: 5, // Vertices density on lines
  color: 0x3b66f2,
  backgroundColor: 0xf4f7f6,
  gravityStrength: 50.0, // Z-displacement
};

// --- Scene ---
const container = document.querySelector('#canvas-container');
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true
});
container.appendChild(renderer.domElement);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.backgroundColor);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 5000);
camera.position.set(0, 0, 900);
camera.lookAt(0, 0, 0);

// --- Particle System Setup ---
// 1. Geometry: A simple quad for the "Rod/Bar"
// We'll scale it in the shader. Base size 1x1.
const baseGeometry = new THREE.PlaneGeometry(1, 1);

// 2. Grid Position Data
function getGridPositions(size, spacing) {
  const positions = [];
  // Center grid
  const cols = Math.floor(size / spacing);
  const rows = Math.floor(size / spacing);
  const offsetX = - (cols * spacing) / 2;
  const offsetY = - (rows * spacing) / 2;

  // Random offset range (fraction of spacing)
  const randomness = spacing * 0.6;

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      // Add random offset for organic feel
      const randX = (Math.random() - 0.5) * randomness;
      const randY = (Math.random() - 0.5) * randomness;
      positions.push(
        offsetX + i * spacing + randX,
        offsetY + j * spacing + randY,
        0 // Z
      );
    }
  }
  return new Float32Array(positions);
}

const positions = getGridPositions(CONFIG.gridSize, CONFIG.gridSpacing);
const instanceCount = positions.length / 3;

const instancedMesh = new THREE.InstancedMesh(baseGeometry, null, instanceCount); // Material added later

// Fill dummy matrices (positions mainly, scale/rotation handled in shader)
const dummy = new THREE.Object3D();
for (let i = 0; i < instanceCount; i++) {
  dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  dummy.updateMatrix();
  instancedMesh.setMatrixAt(i, dummy.matrix);
}
instancedMesh.instanceMatrix.needsUpdate = true;

// --- Shader Material ---
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uColor: { value: new THREE.Color(CONFIG.color) },
  },
  vertexShader: `
    uniform float uTime;
    uniform vec2 uMouse;
    
    varying float vAlpha;
    varying vec2 vUv;
    varying vec2 vSize;

    // --- Noise Functions ---
    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
               -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy) );
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1;
      i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
      + i.x + vec3(0.0, i1.x, 1.0 ));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m ;
      m = m*m ;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vUv = uv;
      
      // Get instance position from the matrix
      // instanceMatrix is a mat4 attribute automatically provided by InstancedMesh
      vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec3 pos = instancePos.xyz;

      // --- Noise & Wave Logic ---
      float noiseVal = snoise(pos.xy * 0.0015 + uTime * 0.2);
      
      // Distance to mouse
      // Add subtle wandering to dead zone center
      vec2 wanderOffset = vec2(
        sin(uTime * 0.8) * 20.0 + cos(uTime * 1.3) * 15.0,
        cos(uTime * 0.6) * 20.0 + sin(uTime * 1.1) * 15.0
      );
      vec2 deadZoneCenter = uMouse + wanderOffset;
      float dist = distance(pos.xy, deadZoneCenter);
      
      // === Dead Zone (Inner Radius) ===
      // Waves start from this boundary, not the center
      // Add noise to make the boundary organic
      // Smaller core dead zone, larger transition
      float innerRadius = 120.0 + noiseVal * 40.0;
      float effectiveDist = max(0.0, dist - innerRadius);
      
      // Suppression factor: reduced inside dead zone, full outside
      // Much larger transition zone (120px) for gradual fade
      // Higher minimum (0.2) so content is always visible, just smaller/fainter
      float suppressionFactor = 0.2 + 0.8 * smoothstep(0.0, 120.0, dist - innerRadius);
      
      // === Single Breathing Wave ===
      // Wave peak position oscillates in/out (0 to maxRange)
      // Much wider outer ring
      float maxWaveRange = 400.0;
      // sin oscillates -1 to 1, map to 0 to maxRange
      float wavePeakPos = maxWaveRange * 0.5 * (1.0 + sin(uTime * 1.5));
      
      // === Domain Warping for Irregular Wave Shape ===
      // Distort the distance field with noise to create organic shapes
      // Use a different noise sample than before for variety
      float warpNoise = snoise(pos.xy * 0.003 + uTime * 0.3);
      float warpNoise2 = snoise(pos.xy * 0.007 - uTime * 0.2);
      // Combine for more complexity
      float distWarp = (warpNoise + warpNoise2 * 0.5) * 60.0;
      
      // Warped effective distance for wave calculation
      float warpedEffectiveDist = effectiveDist + distWarp;
      
      // Distance from current point to the wave peak (using warped distance)
      float distFromPeak = abs(warpedEffectiveDist - wavePeakPos);
      
      // Gaussian-like falloff for a single clean pulse
      // Much wider wave for broader effect
      float waveWidth = 180.0 + noiseVal * 40.0;
      float wave = exp(-distFromPeak * distFromPeak / (waveWidth * waveWidth));
      
      // --- Energy & Appearance ---
      // Envelope: slower decay for much wider visible ring
      float envelope = max(0.0, 1.0 - effectiveDist * 0.0015); 
      envelope = pow(envelope, 1.5);

      // Combine wave peak with envelope
      float waveEnergy = wave * envelope;
      
      // Base visibility: always visible within the ring (not dependent on wave)
      // This prevents "all invisible" moments
      float baseVisibility = 0.15 * envelope;
      
      // Final: max of base visibility and wave-driven intensity
      // Apply suppression (dead zone shows dots, not blank)
      // Stronger wave peaks (reduced exponent)
      float finalIntensity = max(baseVisibility, 0.05 + 0.95 * pow(waveEnergy, 1.0)) * suppressionFactor; 

      // --- Rotation (Point to Mouse with Dynamic Offset) ---
      vec2 dir = normalize(uMouse - pos.xy);
      float baseAngle = atan(dir.y, dir.x);
      
      // Dynamic rotation offset based on position and time
      // Each particle has unique phase based on its position
      float rotationNoise = snoise(pos.xy * 0.005 + uTime * 0.5);
      float rotationOffset = rotationNoise * 0.5; // ±0.5 radians (~28 degrees)
      
      float angle = baseAngle + rotationOffset;
      
      // Rotation Matrix (Z-axis)
      // Fix: GLSL mat2 is column-major.
      // We want to rotate by +angle.
      // [ cos  -sin ]
      // [ sin   cos ]
      // Col 1: (cos, sin) -> (c, s)
      // Col 2: (-sin, cos) -> (-s, c)
      float c = cos(angle);
      float s = sin(angle);
      mat2 rot = mat2(c, s, -s, c);
      
      // --- Scaling (The "Rod" Shape) ---
      // Base: 3x3 (Point-like when inactive)
      // Max: ~15x5 (Shorter rods)
      float len = 3.0 + 12.0 * finalIntensity; 
      float thick = 3.0 + 2.0 * finalIntensity;
      
      // Pass size to fragment for SDF
      vSize = vec2(len, thick);

      // Apply scale to vertex position
      vec3 transformed = position; 
      transformed.x *= len;
      transformed.y *= thick;
      
      // Apply Rotation
      transformed.xy = rot * transformed.xy;
      
      // Move to instance position
      transformed += pos;
      
      // === Radial Displacement (Push Effect) ===
      // Push rods away from center based on wave energy
      vec2 pushDir = normalize(pos.xy - uMouse);
      // Stronger push when wave is high
      float pushStrength = waveEnergy * 80.0;
      transformed.xy += pushDir * pushStrength;
      
      // Add some Z-wave lift
      transformed.z += wave * 70.0 * envelope;

      vAlpha = finalIntensity;
      
      gl_Position = projectionMatrix * viewMatrix * vec4(transformed, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    varying float vAlpha;
    varying vec2 vUv;
    varying vec2 vSize;
    
    // Signed Distance Function for Rounded Box
    // p: point, b: half-extent (box size / 2 - radius), r: corner radius
    float sdRoundedBox( in vec2 p, in vec2 b, in float r ) {
        vec2 q = abs(p) - b;
        return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r;
    }

    void main() {
      // Convert UV to Local Coordinate Space (Physical size)
      vec2 p = (vUv * 2.0 - 1.0) * vSize * 0.5;
      
      // Determine Radius for full roundness (Capsule style)
      // Radius = half height
      float r = vSize.y * 0.5;
      
      // Box half-extent
      // Width needs to shrink by r to accommodate the round caps
      // Height needs to shrink by r? No, box extent is dist from center to flat edge.
      // If we want total height = vSize.y, and radius = vSize.y/2, then vertical straight segment is 0.
      vec2 b = vec2(vSize.x * 0.5 - r, 0.0);
      
      // However, if size.x < size.y (short rod), this might behave oddly.
      // Let's ensure b.x >= 0.
      if (b.x < 0.0) {
        // Just a circle/squircle if very short
        r = min(vSize.x, vSize.y) * 0.5;
        b = vSize * 0.5 - r;
      }

      float dist = sdRoundedBox(p, b, r);
      
      // Smooth edges (aa)
      float smoothness = 1.0; // 1 pixel blur for AA
      float alphaShape = 1.0 - smoothstep(-0.5, 0.5, dist); 
      
      vec3 col = uColor;
      
      // Opacity correlation + Shape Cutout
      float alpha = vAlpha * alphaShape;
      
      if (alpha < 0.01) discard; 

      // Boost brightness for high alpha
      if (vAlpha > 0.5) {
         col += vec3(0.5) * (vAlpha - 0.5);
      }

      gl_FragColor = vec4(col, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
});

instancedMesh.material = material;
scene.add(instancedMesh);


// --- Interaction ---
const mouse = new THREE.Vector2(0, 0);
const targetMouse = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

window.addEventListener('mousemove', (e) => {
  const ncX = (e.clientX / window.innerWidth) * 2 - 1;
  const ncY = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(ncX, ncY), camera);
  const intersect = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, intersect);
  targetMouse.copy(intersect);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Animate ---
function animate() {
  requestAnimationFrame(animate);
  mouse.lerp(targetMouse, 0.03); // More lag for fluid feel
  material.uniforms.uMouse.value.copy(mouse);
  material.uniforms.uTime.value = performance.now() * 0.001;
  renderer.render(scene, camera);
}

animate();
