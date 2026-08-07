// ==========================================
// ENGINE CONSTANTS & SETUP
// ==========================================
const CHUNK_SIZE = 16;
const MAX_HEIGHT = 768;
const RENDER_DISTANCE = 2;

const BLOCK_TYPES = {
    0: { name: 'Air', transparent: true, solid: false },
    1: { name: 'Grass', color: 0x4CAF50, transparent: false, solid: true },
    2: { name: 'Dirt', color: 0x795548, transparent: false, solid: true },
    3: { name: 'Wood', color: 0x8D6E63, transparent: false, solid: true },
    4: { name: 'Sand', color: 0xFBC02D, transparent: false, solid: true },
    5: { name: 'Stone', color: 0x757575, transparent: false, solid: true },
    6: { name: 'Leaves', color: 0x2E7D32, transparent: true, solid: true },   // Transparent BUT Solid
    7: { name: 'Water', color: 0x2196F3, transparent: true, solid: false, opacity: 0.6 } // Transparent & Non-solid
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
scene.fog = new THREE.FogExp2(0x87CEEB, 0.005);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(50, 400, 50);
scene.add(dirLight);

// ==========================================
// DEV TOOLS UI
// ==========================================
let isFreeCam = false;

const devBtn = document.createElement('button');
devBtn.innerText = '⚙ Dev Tools';
devBtn.className = 'dev-ui';
devBtn.style.cssText = 'position:fixed; top:10px; right:10px; z-index:100; padding:10px 15px; background:rgba(0,0,0,0.6); color:white; border:2px solid #555; border-radius:8px; font-weight:bold; font-family:sans-serif;';
document.body.appendChild(devBtn);

const devMenu = document.createElement('div');
devMenu.className = 'dev-ui';
devMenu.style.cssText = 'display:none; position:fixed; top:60px; right:10px; z-index:100; background:rgba(0,0,0,0.8); padding:15px; border-radius:8px; border:1px solid #555; flex-direction:column; gap:10px;';
document.body.appendChild(devMenu);

devBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    devMenu.style.display = devMenu.style.display === 'none' ? 'flex' : 'none';
});

const freeCamBtn = document.createElement('button');
freeCamBtn.innerText = 'Free Cam: OFF';
freeCamBtn.className = 'dev-ui';
freeCamBtn.style.cssText = 'padding:10px; background:#444; color:white; border:none; border-radius:5px; font-weight:bold;';
freeCamBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isFreeCam = !isFreeCam;
    freeCamBtn.innerText = `Free Cam: ${isFreeCam ? 'ON' : 'OFF'}`;
    freeCamBtn.style.background = isFreeCam ? '#4CAF50' : '#444';
    if (isFreeCam) playerVelocity.y = 0;
});
devMenu.appendChild(freeCamBtn);

// ==========================================
// ASYNC WORKER & WORLD DATA
// ==========================================
const chunks = new Map();
function getChunkKey(cx, cz) { return `${cx},${cz}`; }
function getIndex(x, y, z) { return x + CHUNK_SIZE * (z + CHUNK_SIZE * y); }

const worldWorker = new Worker('./worldWorker.js');

worldWorker.onmessage = function (e) {
    const { cx, cz, allocatedHeight, data } = e.data;
    const key = getChunkKey(cx, cz);
    
    const chunkData = new Uint8Array(data);
    chunks.set(key, { 
        data: chunkData, 
        allocatedHeight: allocatedHeight, 
        mesh: null 
    });
    
    buildChunkMesh(cx, cz);
    
    // GUARANTEED SAFE SPAWN: Only spawns once chunk (0,0) data is fully loaded in memory
    if (cx === 0 && cz === 0 && !window.playerSpawned) {
        spawnPlayerSafely();
        window.playerSpawned = true;
    }
};

function spawnPlayerSafely() {
    let spawnY = MAX_HEIGHT - 1;
    // Skip air (0) AND water (7) when looking for spawn surface
    while (spawnY > 0) {
        let block = getBlock(8, spawnY, 8);
        if (block !== 0 && block !== 7) break;
        spawnY--;
    }
    camera.position.set(8.5, spawnY + 1 + 5.0, 8.5);
}

function getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= MAX_HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = chunks.get(getChunkKey(cx, cz));
    if (!chunk || !chunk.data) return 0;
    if (wy >= chunk.allocatedHeight) return 0;
    
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.data[getIndex(lx, wy, lz)];
}

function setBlock(wx, wy, wz, blockID) {
    if (wy < 0 || wy >= MAX_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = getChunkKey(cx, cz);
    let chunk = chunks.get(key);
    if (!chunk || !chunk.data) return;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    if (wy >= chunk.allocatedHeight) {
        const newHeight = wy + 1;
        const newData = new Uint8Array(CHUNK_SIZE * newHeight * CHUNK_SIZE);
        newData.set(chunk.data);
        chunk.data = newData;
        chunk.allocatedHeight = newHeight;
    }

    chunk.data[getIndex(lx, wy, lz)] = blockID;
    buildChunkMesh(cx, cz);
    if (lx === 0) buildChunkMesh(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) buildChunkMesh(cx + 1, cz);
    if (lz === 0) buildChunkMesh(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) buildChunkMesh(cx, cz + 1);
}

function updateWorld() {
    const playerCX = Math.floor(camera.position.x / CHUNK_SIZE);
    const playerCZ = Math.floor(camera.position.z / CHUNK_SIZE);
    for (let cx = playerCX - RENDER_DISTANCE; cx <= playerCX + RENDER_DISTANCE; cx++) {
        for (let cz = playerCZ - RENDER_DISTANCE; cz <= playerCZ + RENDER_DISTANCE; cz++) {
            const key = getChunkKey(cx, cz);
            if (!chunks.has(key)) {
                chunks.set(key, { data: null, allocatedHeight: 0, mesh: null });
                worldWorker.postMessage({ cx, cz });
            }
        }
    }
}

// ==========================================
// GREEDY MESH GENERATOR
// ==========================================
function buildChunkMesh(cx, cz) {
    const key = getChunkKey(cx, cz);
    const chunk = chunks.get(key);
    if (!chunk || !chunk.data) return;
    if (chunk.mesh) { scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); }
    
    const positions = [], normals = [], colors = [], indices = [];
    let vertexCount = 0;
    const faces = [
        { dir: [1, 0, 0], mergeAxis: 'z', corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
        { dir: [-1, 0, 0], mergeAxis: 'z', corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
        { dir: [0, 1, 0], mergeAxis: 'x', corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
        { dir: [0, -1, 0], mergeAxis: 'x', corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
        { dir: [0, 0, 1], mergeAxis: 'x', corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
        { dir: [0, 0, -1], mergeAxis: 'x', corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] }
    ];

    const heightLimit = chunk.allocatedHeight;

    for (const face of faces) {
        const emitQuad = (run) => {
            const wx = cx * CHUNK_SIZE + run.x;
            const wz = cz * CHUNK_SIZE + run.z;
            const blockDef = BLOCK_TYPES[run.blockID] || { color: 0xFFFFFF };
            const hex = blockDef.color || 0xFFFFFF;
            const shade = face.dir[1] === 1 ? 1.0 : (face.dir[1] === -1 ? 0.5 : 0.8);
            const c = new THREE.Color(hex).multiplyScalar(shade);
            for (const corner of face.corners) {
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
            for (let y = 0; y < heightLimit; y++) {
                for (let z = 0; z < CHUNK_SIZE; z++) {
                    let currentRun = null;
                    for (let x = 0; x < CHUNK_SIZE; x++) {
                        let blockID = chunk.data[getIndex(x, y, z)];
                        let exposed = false;
                        if (blockID !== 0) {
                            let neighborID = getBlock((cx * CHUNK_SIZE + x) + face.dir[0], y + face.dir[1], (cz * CHUNK_SIZE + z) + face.dir[2]);
                            if (neighborID === 0 || (BLOCK_TYPES[neighborID] && BLOCK_TYPES[neighborID].transparent)) exposed = true;
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
            for (let y = 0; y < heightLimit; y++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    let currentRun = null;
                    for (let z = 0; z < CHUNK_SIZE; z++) {
                        let blockID = chunk.data[getIndex(x, y, z)];
                        let exposed = false;
                        if (blockID !== 0) {
                            let neighborID = getBlock((cx * CHUNK_SIZE + x) + face.dir[0], y + face.dir[1], (cz * CHUNK_SIZE + z) + face.dir[2]);
                            if (neighborID === 0 || (BLOCK_TYPES[neighborID] && BLOCK_TYPES[neighborID].transparent)) exposed = true;
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
    const material = new THREE.MeshLambertMaterial({ 
    vertexColors: true, 
    transparent: true, 
    opacity: 0.8 
});
    chunk.mesh = new THREE.Mesh(geometry, material);
    scene.add(chunk.mesh);
}

// ==========================================
// CONTINUOUS MINING & PLACING ENGINE
// ==========================================
const raycaster = new THREE.Raycaster();
let mineInterval = null;

function raycastAction(action) {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(Array.from(chunks.values()).map(c => c.mesh).filter(Boolean));

    if (hits.length > 0 && hits[0].distance < 18) {
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

function startContinuousMining() {
    if (mineInterval) return;
    raycastAction('mine');
    mineInterval = setInterval(() => {
        raycastAction('mine');
    }, 200);
}

function stopContinuousMining() {
    if (mineInterval) {
        clearInterval(mineInterval);
        mineInterval = null;
    }
}

// ==========================================
// SPLIT-SCREEN TOUCH CONTROLS
// ==========================================
const moveVector = { x: 0, y: 0 };
let leftTouchId = null;
let rightTouchId = null;
let leftTouchStart = { x: 0, y: 0 };
let rightTouchPrev = { x: 0, y: 0 };
let rightTouchStartTime = 0;
let rightTouchMoved = false;
let holdTimer = null;

window.addEventListener('touchstart', (e) => {
    if (e.target.closest('button') || e.target.closest('.block-option') || e.target.closest('.dev-ui')) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
        let touch = e.changedTouches[i];
        if (touch.clientX < window.innerWidth / 2) {
            if (leftTouchId === null) {
                leftTouchId = touch.identifier;
                leftTouchStart.x = touch.clientX;
                leftTouchStart.y = touch.clientY;
            }
        } else {
            if (rightTouchId === null) {
                rightTouchId = touch.identifier;
                rightTouchPrev.x = touch.clientX;
                rightTouchPrev.y = touch.clientY;
                rightTouchStartTime = Date.now();
                rightTouchMoved = false;

                holdTimer = setTimeout(() => {
                    if (!rightTouchMoved) {
                        startContinuousMining();
                    }
                }, 250);
            }
        }
    }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        let touch = e.changedTouches[i];
        
        if (touch.identifier === leftTouchId) {
            let dx = touch.clientX - leftTouchStart.x;
            let dy = touch.clientY - leftTouchStart.y;
            const maxRadius = 50;
            const dist = Math.hypot(dx, dy);
            
            if (dist > maxRadius) {
                dx = (dx / dist) * maxRadius;
                dy = (dy / dist) * maxRadius;
            }
            moveVector.x = dx / maxRadius;
            moveVector.y = dy / maxRadius;
            
        } else if (touch.identifier === rightTouchId) {
            let dx = touch.clientX - rightTouchPrev.x;
            let dy = touch.clientY - rightTouchPrev.y;
            
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                rightTouchMoved = true;
                clearTimeout(holdTimer);
            }

            yaw -= dx * 0.005;   
            pitch -= dy * 0.005; 
            pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));
            
            rightTouchPrev.x = touch.clientX;
            rightTouchPrev.y = touch.clientY;
        }
    }
}, { passive: false });

const handleTouchEnd = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        let touch = e.changedTouches[i];
        if (touch.identifier === leftTouchId) {
            leftTouchId = null;
            moveVector.x = 0;
            moveVector.y = 0;
        } else if (touch.identifier === rightTouchId) {
            rightTouchId = null;
            clearTimeout(holdTimer);
            stopContinuousMining();

            const touchDuration = Date.now() - rightTouchStartTime;
            if (!rightTouchMoved && touchDuration < 250) {
                raycastAction('place');
            }
        }
    }
};

window.addEventListener('touchend', handleTouchEnd);
window.addEventListener('touchcancel', handleTouchEnd);

document.querySelectorAll('.block-option').forEach(opt => {
    opt.addEventListener('touchstart', (e) => {
        e.preventDefault();
        document.querySelectorAll('.block-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selectedBlockID = parseInt(opt.dataset.id);
    });
});

// ==========================================
// PLAYER PHYSICS & MOVEMENT
// ==========================================
let yaw = 0, pitch = 0;
const playerVelocity = new THREE.Vector3();
let playerOnGround = false;

function isSolidBlock(x, y, z) {
    const blockID = getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    // Water (7) and Air (0) are non-solid
    return blockID !== 0 && blockID !== 7 && BLOCK_TYPES[blockID] && !BLOCK_TYPES[blockID].transparent;
}

function updatePlayer() {
    if (!window.playerSpawned) return;

    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    const speed = isFreeCam ? 0.60 : 0.20; 

    if (isFreeCam) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        
        const moveDir = new THREE.Vector3();
        moveDir.addScaledVector(forward, -moveVector.y * speed);
        moveDir.addScaledVector(side, moveVector.x * speed);

        camera.position.add(moveDir);
        return;
    }

    const walkForward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    const walkSide = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();

    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(walkForward, -moveVector.y * speed);
    moveDir.addScaledVector(walkSide, moveVector.x * speed);

    playerVelocity.y = Math.max(-0.5, playerVelocity.y - 0.025);

    const nextX = camera.position.x + moveDir.x;
    const nextZ = camera.position.z + moveDir.z;
    const radius = 0.35;

    let eyeY = camera.position.y;
    let feetY = eyeY - 5.0; // 5.0 block height
    const STEP_HEIGHT = 1.05;

    const checkCollisionAtY = (testY) => {
        let collideX = false, collideZ = false;
        for (let checkY = testY; checkY <= testY + 4.5; checkY += 1.5) {
            if (isSolidBlock(nextX + (moveDir.x > 0 ? radius : -radius), checkY, camera.position.z)) collideX = true;
            if (isSolidBlock(camera.position.x, checkY, nextZ + (moveDir.z > 0 ? radius : -radius))) collideZ = true;
        }
        return { collideX, collideZ };
    };

    let { collideX, collideZ } = checkCollisionAtY(feetY);

    if ((collideX || collideZ) && playerOnGround) {
        const stepY = feetY + STEP_HEIGHT;
        const stepResult = checkCollisionAtY(stepY);
        const headClear = !isSolidBlock(camera.position.x, eyeY + STEP_HEIGHT, camera.position.z);

        if (!stepResult.collideX && !stepResult.collideZ && headClear) {
            camera.position.y += STEP_HEIGHT;
            collideX = false;
            collideZ = false;
        }
    }

    if (!collideX) camera.position.x = nextX;
    if (!collideZ) camera.position.z = nextZ;

    camera.position.y += playerVelocity.y;
    const newFeetY = camera.position.y - 5.0;

    const feetCorners = [
        [camera.position.x - radius, camera.position.z - radius],
        [camera.position.x + radius, camera.position.z - radius],
        [camera.position.x - radius, camera.position.z + radius],
        [camera.position.x + radius, camera.position.z + radius]
    ];

    let groundHit = false;
    for (const [cx, cz] of feetCorners) {
        if (isSolidBlock(cx, newFeetY, cz)) {
            groundHit = true;
            break;
        }
    }

    if (groundHit) {
        camera.position.y = Math.floor(newFeetY) + 1 + 5.0;
        playerVelocity.y = 0;
        playerOnGround = true;
    } else {
        playerOnGround = false;
    }
}

// ==========================================
// MAIN LOOP & RESIZE
// ==========================================
updateWorld();

function animate() {
    requestAnimationFrame(animate);
    updatePlayer();
    if (window.playerSpawned) {
        updateWorld();
    }
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
