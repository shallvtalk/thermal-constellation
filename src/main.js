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
camera.position.set(0, 0, 800);
camera.lookAt(0, 0, 0);

// --- Grid Generation ---
function createGridGeometry(size, spacing, resolution) {
  const points = [];

  // Horizontal Lines
  for (let y = -size / 2; y <= size / 2; y += spacing) {
    // Create a line from -size/2 to size/2
    for (let x = -size / 2; x < size / 2; x += resolution) {
      points.push(x, y, 0);
      // LineSegments needs pairs, so the end of this segment is the start of next?
      // To make a continuous line with LineSegments, we need (p1, p2), (p2, p3).
      // Or we can use THREE.Line and create separate objects, but that's slow.
      // Better: Use one huge LineSegments geometry where we explicitly duplicate internal vertices.

      const xNext = Math.min(x + resolution, size / 2);
      points.push(xNext, y, 0);
    }
  }

  // Vertical Lines
  for (let x = -size / 2; x <= size / 2; x += spacing) {
    for (let y = -size / 2; y < size / 2; y += resolution) {
      points.push(x, y, 0);
      const yNext = Math.min(y + resolution, size / 2);
      points.push(x, yNext, 0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

const geometry = createGridGeometry(CONFIG.gridSize, CONFIG.gridSpacing, CONFIG.lineResolution);

// --- Material ---
// We use a shader to distort the grid vertices based on mouse position
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uColor: { value: new THREE.Color(CONFIG.color) }
  },
  vertexShader: `
    uniform float uTime;
    uniform vec2 uMouse;
    
    varying float vIntensity; 
    varying float vWave;

    // --- 1. 引入 Simplex Noise 算法 (标准 GLSL 实现) ---
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
      vec3 pos = position;
      
      // --- 2. 计算噪声场 ---
      // 使用 position * 缩放系数 + 时间 来生成流动的噪声
      // 这里的 0.0015 控制噪声的"颗粒度"（越小越平滑）
      float noiseVal = snoise(pos.xy * 0.0010 + uTime * 0.2);
      
      // --- 3. 坐标扰动 (Domain Warping) ---
      // 关键步骤：在计算距离之前，把点的位置根据噪声偏移一下
      // 这会让原本是圆形的 distance 场变得扭曲
      vec2 distortedPos = pos.xy + vec2(noiseVal * 100.0); // 200.0 是扭曲力度

      // 使用扰动后的坐标计算距离
      float dist = distance(distortedPos, uMouse);
      
      // --- 4. 生成非正圆波浪 ---
      // 依然使用 dist，但因为 dist 已经被扭曲了，所以波浪也是扭曲的
      // 叠加一点 noiseVal 到相位中，让波浪不再是完美的正弦波
      float wave = sin(dist * 0.02 - uTime * 3.0 + noiseVal * 2.0);
      
      // 叠加第二次噪声，制造表面的细碎褶皱（高频噪声）
      float fineNoise = snoise(pos.xy * 0.01 - uTime * 0.5);
      wave += fineNoise * 0.3; // 混合 30% 的细碎波纹

      vWave = wave;

      // --- 5. 能量衰减 ---
      // 能量计算还是基于原始的物理距离（让鼠标中心依然是最强的）
      float trueDist = distance(pos.xy, uMouse);
      float energy = max(0.0, 1.0 - trueDist * 0.0008);
      // 让能量分布也稍微随机一点
      energy *= (0.8 + 0.4 * noiseVal); 
      
      // 应用 Z 轴置换
      pos.z += wave * 60.0 * energy;
      
      vIntensity = energy;

      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    varying float vIntensity;
    varying float vWave;
    
    void main() {
      vec3 col = uColor;
      
      // 归一化波浪
      float waveNorm = (vWave + 1.0) * 0.5;
      
      // 增加对比度，提取高光
      float waveContrast = pow(waveNorm, 4.0); // 增加指数，让高光更细锐
      
      // 基础透明度 + 动态高光
      float alpha = 0.1 + 0.9 * vIntensity * waveContrast;

      // 颜色混合
      col = mix(col, vec3(1.0), vIntensity * waveContrast * 0.8);

      gl_FragColor = vec4(col, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  // 使用 lineLoop 或 lines 时，linewidth 在很多浏览器（如 Chrome Windows）限制为 1
  // 这里主要靠透明度变化来体现视觉厚度
});
const gridLines = new THREE.LineSegments(geometry, material);
scene.add(gridLines);

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

  mouse.lerp(targetMouse, 0.1); // Smooth mouse follow

  material.uniforms.uMouse.value.copy(mouse);
  material.uniforms.uTime.value = performance.now() * 0.001;

  renderer.render(scene, camera);
}

animate();
