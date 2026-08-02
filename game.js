// ==========================================
// ENGINE CONSTANTS & 1FT SCALE SETTINGS
// ==========================================
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64; // Increased for taller terrain (1ft scale)
const RENDER_DISTANCE = 1; // 3x3 chunks

const BLOCK_TYPES = {
    0: { name: 'Air', transparent: true },
    1: { name: 'Grass', color: 0x4CAF50 },
    2: { name: 'Dirt', color: 0x795548 },
    3: { name: 'Wood', color: 0x8D6E63 },
    4: { name: 'Sand', color: 0xFBC02D },
    5: { name: 'Stone', color: 0x757575 },
    6: { name: 'Leaves', color: 0x2E7D32, transparent: true }
};

let selectedBlockID = 3;

// ==========================================
// INITIALIZE THREE.JS SCENE
// ==========================================
const canvas = document.getElementById('webgl-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x87CEEB);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x87CEEB, 0.015); // Slightly thinner fog for scale

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(8, 50, 8); // Spawn higher up

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(50, 100, 50);
scene.add(dirLight);

const simplex = new SimplexNoise();

// ==========================================
// CHUNK & WORLD GENERATION (HIGH RES)
// ==========================================
const chunks = new Map();

function getChunkKey(cx, cz) { return `${cx},${cz}`; }
function getIndex(x, y, z) { return x + CHUNK_SIZE * (z + CHUNK_SIZE * y); }

function generateChunkData(cx, cz) {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;

            // Smoother, taller terrain for 1ft scale
            let height = Math.floor(30 + simplex.noise2D(wx * 0.015, wz * 0.015) * 18);

            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                let block = 0;

                if (y <= height) {
                    if (y === height) {
                        block = (height < 28) ? 4 : 1; 
                    } else if (y > height - 4) {
                        block = (height < 28) ? 4 : 2; 
                    } else {
                        block = 5; 
                    }

                    // 3D Cave carving (scaled up)
                    let density = simplex.noise3D(wx * 0.03, y * 0.03, wz * 0.03);
                    if (Math.abs(density) < 0.08 && y < height - 2 && y > 5) {
                        block = 0; 
                    }
                }
                data[getIndex(x, y, z)] = block;
            }

            // High-res Tree Placement
            if (height >= 28 && Math.abs(simplex.noise2D(wx * 0.5, wz * 0.5)) > 0.85) {
                const trunkHeight = Math.floor(8 + Math.random() * 5); // 8-12 ft tall trunks
                for (let ty = 1; ty <= trunkHeight; ty++) {
                    if (height + ty < CHUNK_HEIGHT) data[getIndex(x, height + ty, z)] = 3; 
                }
                // Voxel diamond canopy
                for (let lx = -2; lx <= 2; lx++) {
                    for (let lz = -2; lz <= 2; lz++) {
                        for (let ly = trunkHeight - 2; ly <= trunkHeight + 2; ly++) {
                            if (Math.abs(lx) + Math.abs(ly - trunkHeight) + Math.abs(lz) <= 3) {
                                let tx = x + lx, tz = z + lz, ty = height + ly;
                                if (tx >= 0 && tx < CHUNK_SIZE && tz >= 0 && tz < CHUNK_SIZE && ty < CHUNK_HEIGHT) {
                                    let idx = getIndex(tx, ty, tz);
                                    if (data[idx] === 0) data[idx] = 6; 
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
    const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = chunks.get(getChunkKey(cx, cz));
    if (!chunk) return 0;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    return chunk.data[getIndex(lx, wy, lz)];
}

function setBlock(wx, wy, wz, blockID) {
    const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = chunks.get(getChunkKey(cx, cz));
    if (!chunk) return;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    
    chunk.data[getIndex(lx, wy, lz)] = blockID;
    buildChunkMesh(cx, cz);

    if (lx === 0) buildChunkMesh(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) buildChunkMesh(cx + 1, cz);
    if (lz === 0) buildChunkMesh(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) buildChunkMesh(cx, cz + 1);
}

// ==========================================
// 1D GREEDY MESHER
// ==========================================
function buildChunkMesh(cx, cz) {
    const key = getChunkKey(cx, cz);
    const chunk = chunks.get(key);
    if (!chunk) return;
    if (chunk.mesh) { scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); }

    const positions = [], normals = [], colors = [], indices = [];
    let vertexCount = 0;

    // mergeAxis defines which direction we stretch identical blocks
    const faces = [
        { dir: [1, 0, 0], mergeAxis: 'z', corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] }, // East
        { dir: [-1, 0, 0], mergeAxis: 'z', corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] }, // West
        { dir: [0, 1, 0], mergeAxis: 'x', corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] }, // Top
        { dir: [0, -1, 0], mergeAxis: 'x', corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] }, // Bottom
        { dir: [0, 0, 1], mergeAxis: 'x', corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] }, // South
        { dir: [0, 0, -1], mergeAxis: 'x', corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }  // North
    ];

    for (const face of faces) {
        const emitQuad = (run) => {
            const wx = cx * CHUNK_SIZE + run.x;
            const wz = cz * CHUNK_SIZE + run.z;
            const hex = BLOCK_TYPES[run.blockID].color || 0xFFFFFF;
            const shade = face.dir[1] === 1 ? 1.0 : (face.dir[1] === -1 ? 0.5 : 0.8);
            const c = new THREE.Color(hex).multiplyScalar(shade);

            for (const corner of face.corners) {
                // Stretch the quad based on the run length along the specified axis
                let px = wx + (corner[0] === 1 && face.mergeAxis === 'x' ? run.length : corner[0]);
                let py = run.y + corner[1];
                let pz = wz + (corner[2] === 1 && face.mergeAxis === 'z' ? run.length : corner[2]);

                positions.push(px, py, pz);
                normals.push(...face.dir);
                colors.push(c.r, c.g, c.b);
            }
            indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
            vertexCount += 4;
        };

        if (face.mergeAxis === 'x') {
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                for (let z = 0; z < CHUNK_SIZE; z++) {
                    let currentRun = null;
                    for (let x = 0; x < CHUNK_SIZE; x++) {
                        let blockID = chunk.data[getIndex(x, y, z)];
                        let exposed = false;
                        if (blockID !== 0) {
                            let neighborID = getBlock((cx * CHUNK_SIZE + x) + face.dir[0], y + face.dir[1], (cz * CHUNK_SIZE + z) + face.dir[2]);
                            if (neighborID === 0 || BLOCK_TYPES[neighborID].transparent) exposed = true;
                        }
                        if (exposed) {
                            if (currentRun && currentRun.blockID === blockID) {
                                currentRun.length++;
                            } else {
                                if (currentRun) emitQuad(currentRun);
                                currentRun = { x, y, z, blockID, length: 1 };
                            }
                        } else {
                            if (currentRun) { emitQuad(currentRun); currentRun = null; }
                        }
                    }
                    if (currentRun) emitQuad(currentRun);
                }
            }
        } else {
            // mergeAxis === 'z'
            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    let currentRun = null;
                    for (let z = 0; z < CHUNK_SIZE; z++) {
                        let blockID = chunk.data[getIndex(x, y, z)];
                        let exposed = false;
                        if (blockID !== 0) {
                            let neighborID = getBlock((cx * CHUNK_SIZE + x) + face.dir[0], y + face.dir[1], (cz * CHUNK_SIZE + z) + face.dir[2]);
                            if (neighborID === 0 || BLOCK_TYPES[neighborID].transparent) exposed = true;
                        }
                        if (exposed) {
                            if (currentRun && currentRun.blockID === blockID) {
                                currentRun.length++;
                            } else {
                                if (currentRun) emitQuad(currentRun);
                                currentRun = { x, y, z, blockID, length: 1 };
                            }
                        } else {
                            if (currentRun) { emitQuad(currentRun); currentRun = null; }
                        }
                    }
                    if (currentRun) emitQuad(currentRun);
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
    if (!base || !knob) return; 

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

document.querySelectorAll('.btn-mine').forEach(btn => btn.addEventListener('touchstart', (e) => { e.preventDefault(); raycastAction('mine'); }));
document.querySelectorAll('.btn-place').forEach(btn => btn.addEventListener('touchstart', (e) => { e.preventDefault(); raycastAction('place'); }));

const jumpBtn = document.getElementById('btn-jump');
if (jumpBtn) {
    jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (playerOnGround) {
            playerVelocity.y = 0.45; // Scaled up jump for 1ft blocks
            playerOnGround = false;
        }
    });
}

document.querySelectorAll('.block-option').forEach(opt => {
    opt.addEventListener('touchstart', (e) => {
        e.preventDefault();
        document.querySelectorAll('.block-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selectedBlockID = parseInt(opt.dataset.id);
    });
});

// ==========================================
// RAYCASTING (SCALED FOR 1FT REACH)
// ==========================================
const raycaster = new THREE.Raycaster();

function raycastAction(action) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(Array.from(chunks.values()).map(c => c.mesh).filter(Boolean));

    if (hits.length > 0 && hits[0].distance < 18) { // Reach extended to ~18 feet
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
// SCALED PLAYER PHYSICS
// ==========================================
let yaw = 0, pitch = 0;
const playerVelocity = new THREE.Vector3();
let playerOnGround = false;

function updatePlayer() {
    yaw -= lookVector.x * 0.04;
    pitch -= lookVector.y * 0.04;
    pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));

    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();

    const speed = 0.35; // Scaled up movement speed
    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(forward, -moveVector.y * speed);
    moveDir.addScaledVector(side, moveVector.x * speed);

    playerVelocity.y -= 0.025; // Scaled up gravity

    camera.position.x += moveDir.x;
    camera.position.z += moveDir.z;
    camera.position.y += playerVelocity.y;

    const px = Math.floor(camera.position.x);
    const py = Math.floor(camera.position.y - 5.5); // Player eye level is 5.5 ft up
    const pz = Math.floor(camera.position.z);

    if (getBlock(px, py, pz) !== 0) {
        camera.position.y = py + 1 + 5.5;
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
