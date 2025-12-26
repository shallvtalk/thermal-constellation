import './style.css'
import * as THREE from 'three';
import GUI from 'lil-gui';

// ============================================================================
// 移动端检测
// ============================================================================
const isTouchDevice = () => {
  return ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints > 0);
};

const isMobile = () => {
  return window.innerWidth <= 768 || isTouchDevice();
};

// ============================================================================
// 配置参数 - 所有可调节的系数都在这里
// ============================================================================
const CONFIG = {
  // --- 基础设置 ---
  gridSpacing: isMobile() ? 50 : 40,              // 网格间距 (像素) - 移动端更大以提升性能
  gridSize: isMobile() ? 2000 : 3000,             // 网格总大小 (像素) - 移动端更小
  positionRandomness: 0.6,      // 位置随机偏移 (相对于间距的比例, 0-1)
  color: 0x3b66f2,              // 短棒颜色 (十六进制)
  backgroundColor: 0xf4f7f6,    // 背景颜色 (十六进制)

  // --- 鼠标跟随 ---
  mouseLerpSpeed: 0.03,         // 鼠标跟随的平滑系数 (0-1, 越小越慢)

  // --- 死区 (中心透明区域) ---
  deadZone: {
    baseRadius: 120.0,          // 死区基础半径 (像素)
    noiseAmplitude: 40.0,       // 死区边界的噪声振幅 (像素)
    transitionWidth: 120.0,     // 死区到外环的过渡宽度 (像素)
    minVisibility: 0.2,         // 死区内的最低可见度 (0-1)
    wanderAmplitude: 20.0,      // 死区中心漂移的振幅 (像素)
    wanderSpeed1: 0.8,          // 死区中心漂移速度1
    wanderSpeed2: 0.6,          // 死区中心漂移速度2
  },

  // --- 波浪 ---
  wave: {
    maxRange: 400.0,            // 波浪活动的最大范围 (像素)
    speed: 1.5,                 // 波浪呼吸速度
    baseWidth: 180.0,           // 波浪宽度基础值 (像素)
    widthNoise: 40.0,           // 波浪宽度的噪声振幅 (像素)
    warpStrength: 60.0,         // 波浪形状扭曲强度 (像素)
    warpScale1: 0.003,          // 扭曲噪声的缩放系数1
    warpScale2: 0.007,          // 扭曲噪声的缩放系数2
    warpSpeed1: 0.3,            // 扭曲噪声的流动速度1
    warpSpeed2: 0.2,            // 扭曲噪声的流动速度2
  },

  // --- 能量衰减 ---
  envelope: {
    decayRate: 0.0015,          // 能量衰减率 (越大衰减越快)
    power: 1.5,                 // 能量曲线指数
  },

  // --- 短棒旋转 ---
  rotation: {
    noiseScale: 0.005,          // 旋转噪声的缩放系数
    noiseSpeed: 0.5,            // 旋转噪声的速度
    maxOffset: 0.5,             // 最大旋转偏移 (弧度, ~28度)
  },

  // --- 短棒尺寸 ---
  rod: {
    baseLength: 3.0,            // 基础长度 (像素)
    maxLengthAdd: 12.0,         // 最大额外长度 (像素)
    baseThickness: 3.0,         // 基础粗细 (像素)
    maxThicknessAdd: 2.0,       // 最大额外粗细 (像素)
  },

  // --- 位移效果 ---
  displacement: {
    pushStrength: 80.0,         // 推力强度 (像素)
    zLift: 70.0,                // Z轴抬升高度 (像素)
  },

  // --- 基础噪声 ---
  baseNoise: {
    scale: 0.0015,              // 基础噪声缩放
    speed: 0.2,                 // 基础噪声流动速度
  },

  // --- 可见度 ---
  visibility: {
    base: 0.15,                 // 基础可见度 (防止全部消失)
    waveMin: 0.05,              // 波浪最低可见度
    waveMax: 0.95,              // 波浪最高可见度增益
  },

  // --- 高亮 ---
  highlight: {
    threshold: 0.5,             // 高亮触发阈值
    boost: 0.5,                 // 高亮增益
  },
};

// ============================================================================
// 场景初始化
// ============================================================================
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

// ============================================================================
// 粒子系统设置
// ============================================================================

// 基础几何体：一个简单的四边形，用于短棒
const baseGeometry = new THREE.PlaneGeometry(1, 1);

// 生成网格位置数据
function getGridPositions(size, spacing, randomnessFactor) {
  const positions = [];
  const cols = Math.floor(size / spacing);
  const rows = Math.floor(size / spacing);
  const offsetX = -(cols * spacing) / 2;
  const offsetY = -(rows * spacing) / 2;
  const randomness = spacing * randomnessFactor;

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      // 添加随机偏移以获得有机感
      const randX = (Math.random() - 0.5) * randomness;
      const randY = (Math.random() - 0.5) * randomness;
      positions.push(
        offsetX + i * spacing + randX,
        offsetY + j * spacing + randY,
        0
      );
    }
  }
  return new Float32Array(positions);
}

const positions = getGridPositions(CONFIG.gridSize, CONFIG.gridSpacing, CONFIG.positionRandomness);
const instanceCount = positions.length / 3;

const instancedMesh = new THREE.InstancedMesh(baseGeometry, null, instanceCount);

// 填充实例矩阵
const dummy = new THREE.Object3D();
for (let i = 0; i < instanceCount; i++) {
  dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  dummy.updateMatrix();
  instancedMesh.setMatrixAt(i, dummy.matrix);
}
instancedMesh.instanceMatrix.needsUpdate = true;

// ============================================================================
// 着色器材质
// ============================================================================
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uColor: { value: new THREE.Color(CONFIG.color) },
    // 死区参数
    uDeadZoneRadius: { value: CONFIG.deadZone.baseRadius },
    uDeadZoneNoise: { value: CONFIG.deadZone.noiseAmplitude },
    uDeadZoneTransition: { value: CONFIG.deadZone.transitionWidth },
    uDeadZoneMinVis: { value: CONFIG.deadZone.minVisibility },
    uWanderAmp: { value: CONFIG.deadZone.wanderAmplitude },
    uWanderSpeed1: { value: CONFIG.deadZone.wanderSpeed1 },
    uWanderSpeed2: { value: CONFIG.deadZone.wanderSpeed2 },
    // 波浪参数
    uWaveMaxRange: { value: CONFIG.wave.maxRange },
    uWaveSpeed: { value: CONFIG.wave.speed },
    uWaveWidth: { value: CONFIG.wave.baseWidth },
    uWaveWidthNoise: { value: CONFIG.wave.widthNoise },
    uWarpStrength: { value: CONFIG.wave.warpStrength },
    uWarpScale1: { value: CONFIG.wave.warpScale1 },
    uWarpScale2: { value: CONFIG.wave.warpScale2 },
    uWarpSpeed1: { value: CONFIG.wave.warpSpeed1 },
    uWarpSpeed2: { value: CONFIG.wave.warpSpeed2 },
    // 能量衰减参数
    uEnvelopeDecay: { value: CONFIG.envelope.decayRate },
    uEnvelopePower: { value: CONFIG.envelope.power },
    // 旋转参数
    uRotNoiseScale: { value: CONFIG.rotation.noiseScale },
    uRotNoiseSpeed: { value: CONFIG.rotation.noiseSpeed },
    uRotMaxOffset: { value: CONFIG.rotation.maxOffset },
    // 短棒尺寸参数
    uRodBaseLen: { value: CONFIG.rod.baseLength },
    uRodMaxLen: { value: CONFIG.rod.maxLengthAdd },
    uRodBaseThick: { value: CONFIG.rod.baseThickness },
    uRodMaxThick: { value: CONFIG.rod.maxThicknessAdd },
    // 位移参数
    uPushStrength: { value: CONFIG.displacement.pushStrength },
    uZLift: { value: CONFIG.displacement.zLift },
    // 基础噪声参数
    uBaseNoiseScale: { value: CONFIG.baseNoise.scale },
    uBaseNoiseSpeed: { value: CONFIG.baseNoise.speed },
    // 可见度参数
    uVisBase: { value: CONFIG.visibility.base },
    uVisWaveMin: { value: CONFIG.visibility.waveMin },
    uVisWaveMax: { value: CONFIG.visibility.waveMax },
    // 高亮参数
    uHighlightThreshold: { value: CONFIG.highlight.threshold },
    uHighlightBoost: { value: CONFIG.highlight.boost },
  },
  vertexShader: `
    // === Uniforms ===
    uniform float uTime;
    uniform vec2 uMouse;
    // 死区
    uniform float uDeadZoneRadius;
    uniform float uDeadZoneNoise;
    uniform float uDeadZoneTransition;
    uniform float uDeadZoneMinVis;
    uniform float uWanderAmp;
    uniform float uWanderSpeed1;
    uniform float uWanderSpeed2;
    // 波浪
    uniform float uWaveMaxRange;
    uniform float uWaveSpeed;
    uniform float uWaveWidth;
    uniform float uWaveWidthNoise;
    uniform float uWarpStrength;
    uniform float uWarpScale1;
    uniform float uWarpScale2;
    uniform float uWarpSpeed1;
    uniform float uWarpSpeed2;
    // 能量
    uniform float uEnvelopeDecay;
    uniform float uEnvelopePower;
    // 旋转
    uniform float uRotNoiseScale;
    uniform float uRotNoiseSpeed;
    uniform float uRotMaxOffset;
    // 短棒尺寸
    uniform float uRodBaseLen;
    uniform float uRodMaxLen;
    uniform float uRodBaseThick;
    uniform float uRodMaxThick;
    // 位移
    uniform float uPushStrength;
    uniform float uZLift;
    // 基础噪声
    uniform float uBaseNoiseScale;
    uniform float uBaseNoiseSpeed;
    // 可见度
    uniform float uVisBase;
    uniform float uVisWaveMin;
    uniform float uVisWaveMax;
    
    // === Varyings ===
    varying float vAlpha;
    varying vec2 vUv;
    varying vec2 vSize;

    // === Simplex Noise 函数 ===
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
      
      // 获取实例位置
      vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec3 pos = instancePos.xyz;

      // === 基础噪声 ===
      float noiseVal = snoise(pos.xy * uBaseNoiseScale + uTime * uBaseNoiseSpeed);
      
      // === 死区中心漂移 ===
      vec2 wanderOffset = vec2(
        sin(uTime * uWanderSpeed1) * uWanderAmp + cos(uTime * (uWanderSpeed1 + 0.5)) * uWanderAmp * 0.75,
        cos(uTime * uWanderSpeed2) * uWanderAmp + sin(uTime * (uWanderSpeed2 + 0.5)) * uWanderAmp * 0.75
      );
      vec2 deadZoneCenter = uMouse + wanderOffset;
      float dist = distance(pos.xy, deadZoneCenter);
      
      // === 死区计算 ===
      float innerRadius = uDeadZoneRadius + noiseVal * uDeadZoneNoise;
      float effectiveDist = max(0.0, dist - innerRadius);
      
      // 抑制因子：死区内减弱，死区外完全显示
      float suppressionFactor = uDeadZoneMinVis + (1.0 - uDeadZoneMinVis) * smoothstep(0.0, uDeadZoneTransition, dist - innerRadius);
      
      // === 波浪计算 ===
      // 波峰位置在 0 到 maxRange 之间振荡
      float wavePeakPos = uWaveMaxRange * 0.5 * (1.0 + sin(uTime * uWaveSpeed));
      
      // 域扭曲：使波浪形状不规则
      float warpNoise = snoise(pos.xy * uWarpScale1 + uTime * uWarpSpeed1);
      float warpNoise2 = snoise(pos.xy * uWarpScale2 - uTime * uWarpSpeed2);
      float distWarp = (warpNoise + warpNoise2 * 0.5) * uWarpStrength;
      
      // 扭曲后的有效距离
      float warpedEffectiveDist = effectiveDist + distWarp;
      
      // 到波峰的距离
      float distFromPeak = abs(warpedEffectiveDist - wavePeakPos);
      
      // 高斯衰减形成单个脉冲
      float waveWidthVal = uWaveWidth + noiseVal * uWaveWidthNoise;
      float wave = exp(-distFromPeak * distFromPeak / (waveWidthVal * waveWidthVal));
      
      // === 能量衰减 ===
      float envelope = max(0.0, 1.0 - effectiveDist * uEnvelopeDecay); 
      envelope = pow(envelope, uEnvelopePower);

      // 波浪能量
      float waveEnergy = wave * envelope;
      
      // 基础可见度（防止全部消失）
      float baseVisibility = uVisBase * envelope;
      
      // 最终强度
      float finalIntensity = max(baseVisibility, uVisWaveMin + uVisWaveMax * pow(waveEnergy, 1.0)) * suppressionFactor; 

      // === 旋转（指向鼠标 + 动态偏移）===
      vec2 dir = normalize(uMouse - pos.xy);
      float baseAngle = atan(dir.y, dir.x);
      
      // 基于位置和时间的旋转噪声
      float rotationNoise = snoise(pos.xy * uRotNoiseScale + uTime * uRotNoiseSpeed);
      float rotationOffset = rotationNoise * uRotMaxOffset;
      
      float angle = baseAngle + rotationOffset;
      
      // 旋转矩阵
      float c = cos(angle);
      float s = sin(angle);
      mat2 rot = mat2(c, s, -s, c);
      
      // === 短棒尺寸 ===
      float len = uRodBaseLen + uRodMaxLen * finalIntensity; 
      float thick = uRodBaseThick + uRodMaxThick * finalIntensity;
      
      // 传递尺寸到片段着色器
      vSize = vec2(len, thick);

      // 应用缩放
      vec3 transformed = position; 
      transformed.x *= len;
      transformed.y *= thick;
      
      // 应用旋转
      transformed.xy = rot * transformed.xy;
      
      // 移动到实例位置
      transformed += pos;
      
      // === 径向位移（推力效果）===
      vec2 pushDir = normalize(pos.xy - uMouse);
      float pushStrength = waveEnergy * uPushStrength;
      transformed.xy += pushDir * pushStrength;
      
      // Z轴抬升
      transformed.z += wave * uZLift * envelope;

      vAlpha = finalIntensity;
      
      gl_Position = projectionMatrix * viewMatrix * vec4(transformed, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uHighlightThreshold;
    uniform float uHighlightBoost;
    
    varying float vAlpha;
    varying vec2 vUv;
    varying vec2 vSize;
    
    // 圆角矩形 SDF
    float sdRoundedBox( in vec2 p, in vec2 b, in float r ) {
        vec2 q = abs(p) - b;
        return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r;
    }

    void main() {
      // 转换 UV 到本地坐标空间
      vec2 p = (vUv * 2.0 - 1.0) * vSize * 0.5;
      
      // 圆角半径（胶囊形状）
      float r = vSize.y * 0.5;
      
      // 盒子半范围
      vec2 b = vec2(vSize.x * 0.5 - r, 0.0);
      
      // 处理短棒过短的情况
      if (b.x < 0.0) {
        r = min(vSize.x, vSize.y) * 0.5;
        b = vSize * 0.5 - r;
      }

      float dist = sdRoundedBox(p, b, r);
      
      // 平滑边缘（抗锯齿）
      float alphaShape = 1.0 - smoothstep(-0.5, 0.5, dist); 
      
      vec3 col = uColor;
      
      // 形状裁剪 + 透明度
      float alpha = vAlpha * alphaShape;
      
      if (alpha < 0.01) discard; 

      // 高亮效果
      if (vAlpha > uHighlightThreshold) {
         col += vec3(uHighlightBoost) * (vAlpha - uHighlightThreshold);
      }

      gl_FragColor = vec4(col, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
});

instancedMesh.material = material;
scene.add(instancedMesh);

// ============================================================================
// 交互
// ============================================================================
const mouse = new THREE.Vector2(0, 0);
const targetMouse = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

// 通用坐标转换函数
function updateMousePosition(clientX, clientY) {
  const ncX = (clientX / window.innerWidth) * 2 - 1;
  const ncY = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(ncX, ncY), camera);
  const intersect = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, intersect);
  targetMouse.copy(intersect);
}

// 鼠标事件
window.addEventListener('mousemove', (e) => {
  updateMousePosition(e.clientX, e.clientY);
});

// 触摸事件支持
window.addEventListener('touchstart', (e) => {
  if (e.touches.length > 0) {
    const touch = e.touches[0];
    updateMousePosition(touch.clientX, touch.clientY);
  }
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 0) {
    const touch = e.touches[0];
    updateMousePosition(touch.clientX, touch.clientY);
  }
}, { passive: true });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================================
// 动画循环
// ============================================================================

// 面板状态
let isPanelOpen = false;

function animate() {
  requestAnimationFrame(animate);

  // 面板打开时暂停鼠标跟随
  if (!isPanelOpen) {
    mouse.lerp(targetMouse, CONFIG.mouseLerpSpeed);
  }

  // 更新 uniforms
  material.uniforms.uMouse.value.copy(mouse);
  material.uniforms.uTime.value = performance.now() * 0.001;

  renderer.render(scene, camera);
}

animate();

// ============================================================================
// GUI 控制面板
// ============================================================================
const gui = new GUI({ title: '🎛️ 参数调节面板' });

// 默认收起面板
gui.close();

// 监听面板打开/关闭状态
gui.onOpenClose((opened) => {
  isPanelOpen = !gui._closed;
});

// 辅助函数：更新 uniform
function updateUniform(name, value) {
  if (material.uniforms[name]) {
    material.uniforms[name].value = value;
  }
}

// --- 死区设置 ---
const deadZoneFolder = gui.addFolder('🔵 死区 (Dead Zone)');
deadZoneFolder.add(CONFIG.deadZone, 'baseRadius', 0, 400, 1)
  .name('基础半径')
  .onChange(v => updateUniform('uDeadZoneRadius', v));
deadZoneFolder.add(CONFIG.deadZone, 'noiseAmplitude', 0, 100, 1)
  .name('噪声振幅')
  .onChange(v => updateUniform('uDeadZoneNoise', v));
deadZoneFolder.add(CONFIG.deadZone, 'transitionWidth', 10, 300, 1)
  .name('过渡宽度')
  .onChange(v => updateUniform('uDeadZoneTransition', v));
deadZoneFolder.add(CONFIG.deadZone, 'minVisibility', 0, 1, 0.01)
  .name('最低可见度')
  .onChange(v => updateUniform('uDeadZoneMinVis', v));
deadZoneFolder.add(CONFIG.deadZone, 'wanderAmplitude', 0, 100, 1)
  .name('漂移振幅')
  .onChange(v => updateUniform('uWanderAmp', v));
deadZoneFolder.add(CONFIG.deadZone, 'wanderSpeed1', 0, 3, 0.1)
  .name('漂移速度1')
  .onChange(v => updateUniform('uWanderSpeed1', v));
deadZoneFolder.add(CONFIG.deadZone, 'wanderSpeed2', 0, 3, 0.1)
  .name('漂移速度2')
  .onChange(v => updateUniform('uWanderSpeed2', v));

// --- 波浪设置 ---
const waveFolder = gui.addFolder('🌊 波浪 (Wave)');
waveFolder.add(CONFIG.wave, 'maxRange', 100, 800, 10)
  .name('最大范围')
  .onChange(v => updateUniform('uWaveMaxRange', v));
waveFolder.add(CONFIG.wave, 'speed', 0.1, 5, 0.1)
  .name('呼吸速度')
  .onChange(v => updateUniform('uWaveSpeed', v));
waveFolder.add(CONFIG.wave, 'baseWidth', 50, 400, 10)
  .name('波浪宽度')
  .onChange(v => updateUniform('uWaveWidth', v));
waveFolder.add(CONFIG.wave, 'widthNoise', 0, 100, 5)
  .name('宽度噪声')
  .onChange(v => updateUniform('uWaveWidthNoise', v));
waveFolder.add(CONFIG.wave, 'warpStrength', 0, 200, 5)
  .name('扭曲强度')
  .onChange(v => updateUniform('uWarpStrength', v));
waveFolder.add(CONFIG.wave, 'warpSpeed1', 0, 1, 0.05)
  .name('扭曲速度1')
  .onChange(v => updateUniform('uWarpSpeed1', v));
waveFolder.add(CONFIG.wave, 'warpSpeed2', 0, 1, 0.05)
  .name('扭曲速度2')
  .onChange(v => updateUniform('uWarpSpeed2', v));

// --- 能量衰减 ---
const envelopeFolder = gui.addFolder('📉 能量衰减 (Envelope)');
envelopeFolder.add(CONFIG.envelope, 'decayRate', 0.0001, 0.01, 0.0001)
  .name('衰减率')
  .onChange(v => updateUniform('uEnvelopeDecay', v));
envelopeFolder.add(CONFIG.envelope, 'power', 0.5, 4, 0.1)
  .name('曲线指数')
  .onChange(v => updateUniform('uEnvelopePower', v));

// --- 旋转设置 ---
const rotationFolder = gui.addFolder('🔄 旋转 (Rotation)');
rotationFolder.add(CONFIG.rotation, 'noiseScale', 0.001, 0.02, 0.001)
  .name('噪声缩放')
  .onChange(v => updateUniform('uRotNoiseScale', v));
rotationFolder.add(CONFIG.rotation, 'noiseSpeed', 0, 2, 0.1)
  .name('噪声速度')
  .onChange(v => updateUniform('uRotNoiseSpeed', v));
rotationFolder.add(CONFIG.rotation, 'maxOffset', 0, 1.5, 0.05)
  .name('最大偏移(弧度)')
  .onChange(v => updateUniform('uRotMaxOffset', v));

// --- 短棒尺寸 ---
const rodFolder = gui.addFolder('📏 短棒尺寸 (Rod Size)');
rodFolder.add(CONFIG.rod, 'baseLength', 1, 20, 0.5)
  .name('基础长度')
  .onChange(v => updateUniform('uRodBaseLen', v));
rodFolder.add(CONFIG.rod, 'maxLengthAdd', 0, 50, 1)
  .name('额外长度')
  .onChange(v => updateUniform('uRodMaxLen', v));
rodFolder.add(CONFIG.rod, 'baseThickness', 1, 10, 0.5)
  .name('基础粗细')
  .onChange(v => updateUniform('uRodBaseThick', v));
rodFolder.add(CONFIG.rod, 'maxThicknessAdd', 0, 10, 0.5)
  .name('额外粗细')
  .onChange(v => updateUniform('uRodMaxThick', v));

// --- 位移效果 ---
const dispFolder = gui.addFolder('💨 位移效果 (Displacement)');
dispFolder.add(CONFIG.displacement, 'pushStrength', 0, 200, 5)
  .name('推力强度')
  .onChange(v => updateUniform('uPushStrength', v));
dispFolder.add(CONFIG.displacement, 'zLift', 0, 150, 5)
  .name('Z轴抬升')
  .onChange(v => updateUniform('uZLift', v));

// --- 可见度 ---
const visFolder = gui.addFolder('👁️ 可见度 (Visibility)');
visFolder.add(CONFIG.visibility, 'base', 0, 0.5, 0.01)
  .name('基础可见度')
  .onChange(v => updateUniform('uVisBase', v));
visFolder.add(CONFIG.visibility, 'waveMin', 0, 0.5, 0.01)
  .name('波浪最低')
  .onChange(v => updateUniform('uVisWaveMin', v));
visFolder.add(CONFIG.visibility, 'waveMax', 0.5, 1, 0.01)
  .name('波浪增益')
  .onChange(v => updateUniform('uVisWaveMax', v));

// --- 高亮 ---
const highlightFolder = gui.addFolder('✨ 高亮 (Highlight)');
highlightFolder.add(CONFIG.highlight, 'threshold', 0, 1, 0.05)
  .name('触发阈值')
  .onChange(v => updateUniform('uHighlightThreshold', v));
highlightFolder.add(CONFIG.highlight, 'boost', 0, 2, 0.1)
  .name('增益强度')
  .onChange(v => updateUniform('uHighlightBoost', v));

// --- 其他设置 ---
const otherFolder = gui.addFolder('⚙️ 其他 (Other)');
otherFolder.add(CONFIG, 'mouseLerpSpeed', 0.01, 0.2, 0.01)
  .name('鼠标跟随速度');

// ============================================================================
// 快捷键支持
// ============================================================================
window.addEventListener('keydown', (e) => {
  // P 键切换配置面板
  if (e.key === 'p' || e.key === 'P') {
    if (gui._closed) {
      gui.open();
    } else {
      gui.close();
    }
  }
});
