// ==========================================
// ENGINE CONSTANTS & BLOCK TYPES
// ==========================================
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 32;
const RENDER_DISTANCE = 1; // 3x3 chunks (9 total)

const BLOCK_TYPES = {
    0: { name: 'Air', transparent: true },
    1: { name: 'Grass', color: 0x4CAF50 },
    2: { name: 'Dirt', color: 0x795548 },
    3: { name: 'Wood', color: 0x8D6E63 },
    4: { name: 'Sand', color: 0xFBC02D },
    5: { name: 'Stone', color: 0x757575 },
    6: { name: 'Leaves', color: 0x2E7D32, transparent: true }
};

let selectedBlockID = 3; // Default placement block (Wood)

// ==========================================
// INITIALIZE THREE.JS SCENE
// ==========================================
const canvas = document.getElementById('webgl-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x87CEEB); // Sky blue

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x87CEEB, 0.025);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(8, 20, 8); // Spawn point above the terrain

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(50, 100, 50);
scene.add(dirLight);

const simplex = new SimplexNoise();

// ==========================================
// CHUNK & WORLD GENERATION
// ==========================================
const chunks = new Map();

function getChunkKey(cx, cz) {
    return `${cx},${cz}`;
}

function getIndex(x, y, z) {
    return x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
}

function generateChunkData(cx, cz) {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;

            // Heightmap via 2D Simplex Noise
            let height = Math.floor(10 + simplex.noise2D(wx * 0.03, wz * 0.03) * 6);

            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                let block = 0;

                if (y <= height) {
                    if (y === height) {
                        block = (height < 9) ? 4 : 1; // Sand shoreline or Grass
                    } else if (y > height - 3) {
                        block = (height < 9) ? 4 : 2; // Sand or Dirt
                    } else {
                        block = 5; // Stone underground
                    }

                    // 3D Cave carving
                    let density = simplex.noise3D(wx * 0.05, y * 0.05, wz * 0.05);
                    if (Math.abs(density) < 0.11 && y < height - 1 && y > 2) {
                        block = 0; // Cave Air
                    }
                }

                data[getIndex(x, y, z)] = block;
            }

            // Tree Placement Logic
            if (height >= 9 && Math.abs(simplex.noise2D(wx * 0.8, wz * 0.8)) > 0.75) {
                const trunkHeight = 4;
                for (let ty = 1; ty <= trunkHeight; ty++) {
                    if (height + ty < CHUNK_HEIGHT) {
                        data[getIndex(x, height + ty, z)] = 3; // Wood
                    }
                }
                for (let lx = -1; lx <= 1; lx++) {
                    for (let lz = -1; lz <= 1; lz++) {
                        for (let ly = trunkHeight; ly <= trunkHeight + 2; ly++) {
                            let tx = x + lx;
                            let tz = z + lz;
                            let ty = height + ly;
                            if (tx >= 0 && tx < CHUNK_SIZE && tz >= 0 && tz < CHUNK_SIZE && ty < CHUNK_HEIGHT) {
                                let idx = getIndex(tx, ty, tz);
                                if (data[idx] === 0) {
                                    data[idx] = 6; // Leaves
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return data;
}

function getBlock(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = chunks.get(getChunkKey(cx, cz));
    if (!chunk) return 0;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;

    return chunk.data[getIndex(lx, wy, lz)];
}

function setBlock(wx, wy, wz, blockID) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = chunks.get(getChunkKey(cx, cz));
    if (!chunk) return;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;

    chunk.data[getIndex(lx, wy, lz)] = blockID;
    buildChunkMesh(cx, cz);

    // Rebuild adjacent chunks if editing on boundaries
    if (lx === 0) buildChunkMesh(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) buildChunkMesh(cx + 1, cz);
    if (lz === 0) buildChunkMesh(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) buildChunkMesh(cx, cz + 1);
}

// ==========================================
// MESH BUILDER WITH FACE CULLING
// ==========================================
function buildChunkMesh(cx, cz) {
    const key = getChunkKey(cx, cz);
    const chunk = chunks.get(key);
    if (!chunk) return;

    if (chunk.mesh) {
        scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
    }

    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];

    const faces = [
        { dir: [1, 0, 0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
        { dir: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
        { dir: [0, 1, 0], corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
        { dir: [0, -1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
        { dir: [0, 0, 1], corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
        { dir: [0, 0, -1], corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }
    ];

    let vertexCount = 0;

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const blockID = chunk.data[getIndex(x, y, z)];
                if (blockID === 0) continue;

                const wx = cx * CHUNK_SIZE + x;
                const wz = cz * CHUNK_SIZE + z;
                const hexColor = BLOCK_TYPES[blockID].color || 0xFFFFFF;
                const baseColor = new THREE.Color(hexColor);

                for (const face of faces) {
                    const nx = wx + face.dir[0];
                    const ny = y + face.dir[1];
                    const nz = wz + face.dir[2];

                    const neighborID = getBlock(nx, ny, nz);
                    if (neighborID === 0 || BLOCK_TYPES[neighborID].transparent) {
                        const shade = face.dir[1] === 1 ? 1.0 : (face.dir[1] === -1 ? 0.5 : 0.8);
                        const c = baseColor.clone().multiplyScalar(shade);

                        for (const corner of face.corners) {
                            positions.push(wx + corner[0], y + corner[1], wz + corner[2]);
                            normals.push(...face.dir);
                            colors.push(c.r, c.g, c.b);
                        }

                        indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
                        vertexCount += 4;
                    }
                }
            }
        }
    }

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    chunk.mesh = new THREE.Mesh(geometry, material);
    scene.add(chunk.mesh);
}

function updateWorld() {
    for (let cx = -RENDER_DISTANCE; cx <= RENDER_DISTANCE; cx++) {
        for (let cz = -RENDER_DISTANCE; cz <= RENDER_DISTANCE; cz++) {
            const key = getChunkKey(cx, cz);
            if (!chunks.has(key)) {
                const data = generateChunkData(cx, cz);
                chunks.set(key, { data, mesh: null });
                buildChunkMesh(cx, cz);
            }
        }
    }
}

// ==========================================
// DUAL JOYSTICK & TOUCH CONTROLS
// ==========================================
const moveVector = { x: 0, y: 0 };
const lookVector = { x: 0, y: 0 };

function setupJoystick(baseId, knobId, outputVector) {
    const base = document.getElementById(baseId);
    const knob = document.getElementById(knobId);
    if (!base || !knob) return; // Prevent crashes if HTML is missing

    let touchId = null;

    base.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (touchId !== null) return;
        const touch = e.changedTouches[0];
        touchId = touch.identifier;
        updateKnob(touch);
    });

    window.addEventListener('touchmove', (e) => {
        if (touchId === null) return;
        for (let touch of e.changedTouches) {
            if (touch.identifier === touchId) {
                updateKnob(touch);
                break;
            }
        }
    });

    const resetKnob = (e) => {
        if (touchId === null) return;
        for (let touch of e.changedTouches) {
            if (touch.identifier === touchId) {
                touchId = null;
                knob.style.transform = `translate(0px, 0px)`;
                outputVector.x = 0;
                outputVector.y = 0;
                break;
            }
        }
    };

    window.addEventListener('touchend', resetKnob);
    window.addEventListener('touchcancel', resetKnob);

    function updateKnob(touch) {
        const rect = base.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let dx = touch.clientX - centerX;
        let dy = touch.clientY - centerY;
        const maxRadius = rect.width / 2;

        const distance = Math.hypot(dx, dy);
        if (distance > maxRadius) {
            dx = (dx / distance) * maxRadius;
            dy = (dy / distance) * maxRadius;
        }

        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        outputVector.x = dx / maxRadius;
        outputVector.y = dy / maxRadius;
    }
}

setupJoystick('joy-left', 'knob-left', moveVector);
setupJoystick('joy-right', 'knob-right', lookVector);

// Action Buttons
document.querySelectorAll('.btn-mine').forEach(btn => {
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); raycastAction('mine'); });
});

document.querySelectorAll('.btn-place').forEach(btn => {
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); raycastAction('place'); });
});

// Jump Button
const jumpBtn = document.getElementById('btn-jump');
if (jumpBtn) {
    jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (playerOnGround) {
            playerVelocity.y = 0.18;
            playerOnGround = false;
        }
    });
}

// Hotbar Selector
document.querySelectorAll('.block-option').forEach(opt => {
    opt.addEventListener('touchstart', (e) => {
        e.preventDefault();
        document.querySelectorAll('.block-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selectedBlockID = parseInt(opt.dataset.id);
    });
});

// ==========================================
// RAYCASTING (MINE / PLACE)
// ==========================================
const raycaster = new THREE.Raycaster();

function raycastAction(action) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(Array.from(chunks.values()).map(c => c.mesh).filter(Boolean));

    if (hits.length > 0 && hits[0].distance < 6) {
        const hit = hits[0];
        const point = hit.point;
        const normal = hit.face.normal;

        if (action === 'mine') {
            const targetX = Math.floor(point.x - normal.x * 0.1);
            const targetY = Math.floor(point.y - normal.y * 0.1);
            const targetZ = Math.floor(point.z - normal.z * 0.1);
            setBlock(targetX, targetY, targetZ, 0);
        } else if (action === 'place') {
            const targetX = Math.floor(point.x + normal.x * 0.1);
            const targetY = Math.floor(point.y + normal.y * 0.1);
            const targetZ = Math.floor(point.z + normal.z * 0.1);
            setBlock(targetX, targetY, targetZ, selectedBlockID);
        }
    }
}

// ==========================================
// PLAYER PHYSICS & CAMERA ROTATION
// ==========================================
let yaw = 0;
let pitch = 0;
const playerVelocity = new THREE.Vector3();
let playerOnGround = false;

function updatePlayer() {
    // Camera Look
    yaw -= lookVector.x * 0.04;
    pitch -= lookVector.y * 0.04;
    pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));

    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    // Movement 
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();

    const speed = 0.12;
    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(forward, -moveVector.y * speed);
    moveDir.addScaledVector(side, moveVector.x * speed);

    // Gravity
    playerVelocity.y -= 0.009;

    camera.position.x += moveDir.x;
    camera.position.z += moveDir.z;
    camera.position.y += playerVelocity.y;

    // Collision
    const px = Math.floor(camera.position.x);
    const py = Math.floor(camera.position.y - 1.6); // 1.6 blocks tall
    const pz = Math.floor(camera.position.z);

    if (getBlock(px, py, pz) !== 0) {
        camera.position.y = py + 1 + 1.6;
        playerVelocity.y = 0;
        playerOnGround = true;
    } else {
        playerOnGround = false;
    }
}

// ==========================================
// MAIN GAME LOOP
// ==========================================
updateWorld();

function animate() {
    requestAnimationFrame(animate);
    updatePlayer();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
