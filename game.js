// ==========================================
// ENGINE CONSTANTS & 1FT SCALE SETTINGS
// ==========================================
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64; // Taller terrain for 1ft scale
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
scene.fog = new THREE.FogExp2(0x87CEEB, 0.015);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(50, 100, 50);
scene.add(dirLight);

function spawnPlayerSafely() {
    // Find highest solid block at spawn point (8, 8)
    let spawnY = CHUNK_HEIGHT - 1;
    while (spawnY > 0 && getBlock(8, spawnY, 8) === 0) {
        spawnY--;
    }
    // Place player feet above top block (eye height +5.5)
    camera.position.set(8.5, spawnY + 1 + 5.5, 8.5);
}

// ==========================================
// ASYNC WORKER & WORLD GENERATION
// ==========================================
const RENDER_DISTANCE = 2; // Expanded world render area!
const chunks = new Map();

function getChunkKey(cx, cz) { return `${cx},${cz}`; }
function getIndex(x, y, z) { return x + CHUNK_SIZE * (z + CHUNK_SIZE * y); }

// Initialize Worker Background Thread
const worldWorker = new Worker('./worldWorker.js');
window.playerSpawned = false; // Prevents moving until world loads

worldWorker.onmessage = function (e) {
    const { cx, cz, allocatedHeight, data } = e.data;
    const key = getChunkKey(cx, cz);
    
    // Save the dynamic height along with the block data
    const chunkData = new Uint8Array(data);
    chunks.set(key, { 
        data: chunkData, 
        allocatedHeight: allocatedHeight, 
        mesh: null, 
        dirty: true 
    });
    
    // Build visual 3D mesh on main thread
    buildChunkMesh(cx, cz);
    
    // Wait for the center chunk (0,0) to finish loading
    if (cx === 0 && cz === 0 && !window.playerSpawned) {
        spawnPlayerSafely();
        window.playerSpawned = true;
    }
};

function getBlock(x, y, z) {
    if (y < 0 || y >= 768) return 0;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const chunk = chunks.get(key);
    
    if (!chunk || !chunk.data) return 0;
    
    // If checking above the chunk's dynamically allocated height, it's just air
    if (y >= chunk.allocatedHeight) return 0;

    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    return chunk.data[lx + CHUNK_SIZE * (lz + CHUNK_SIZE * y)];
}

function setBlock(x, y, z, id) {
    if (y < 0 || y >= 768) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let chunk = chunks.get(key);
    
    if (!chunk || !chunk.data) return;

    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;

    // If placing a block above the current array limit, expand the array dynamically
    if (y >= chunk.allocatedHeight) {
        const newHeight = y + 1;
        const newData = new Uint8Array(CHUNK_SIZE * newHeight * CHUNK_SIZE);
        // Copy old data into new expanded array
        newData.set(chunk.data);
        chunk.data = newData;
        chunk.allocatedHeight = newHeight;
    }

    chunk.data[lx + CHUNK_SIZE * (lz + CHUNK_SIZE * y)] = id;
    chunk.dirty = true; // Queue for remeshing
}

function updateWorld() {
    // Default to chunk 0,0 if camera isn't set up yet
    const playerCX = Math.floor(camera.position.x / CHUNK_SIZE) || 0;
    const playerCZ = Math.floor(camera.position.z / CHUNK_SIZE) || 0;

    for (let cx = playerCX - RENDER_DISTANCE; cx <= playerCX + RENDER_DISTANCE; cx++) {
        for (let cz = playerCZ - RENDER_DISTANCE; cz <= playerCZ + RENDER_DISTANCE; cz++) {
            const key = getChunkKey(cx, cz);
            if (!chunks.has(key)) {
                // Reserve key to prevent double requests
                chunks.set(key, { data: new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE), mesh: null });
                // Offload math to background thread
                worldWorker.postMessage({ cx, cz });
            }
        }
    }
}

// ==========================================
// 1D GREEDY MESHER
// ==========================================
function buildChunkMesh(cx, cz) {
    const key = getChunkKey(cx, cz);
    const chunk = chunks.get(key);
    if (!chunk || chunk.data.every(v => v === 0)) return;
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

    for (const face of faces) {
        const emitQuad = (run) => {
            const wx = cx * CHUNK_SIZE + run.x;
            const wz = cz * CHUNK_SIZE + run.z;
            const hex = BLOCK_TYPES[run.blockID].color || 0xFFFFFF;
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

// ==========================================
// DEV TOOLS UI (Dynamically Created)
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
    if (isFreeCam) playerVelocity.y = 0; // Freeze falling immediately
});
devMenu.appendChild(freeCamBtn);


// ==========================================
// CONTINUOUS MINING & PLACING ENGINE
// ==========================================
const raycaster = new THREE.Raycaster();
let mineInterval = null;

function raycastAction(action) {
    // Always raycast from the dead center of the screen (where the crosshair is)
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
    raycastAction('mine'); // Fire first block break immediately
    mineInterval = setInterval(() => {
        raycastAction('mine'); // Keep breaking blocks every 200ms while holding
    }, 200);
}

function stopContinuousMining() {
    if (mineInterval) {
        clearInterval(mineInterval);
        mineInterval = null;
    }
}


// ==========================================
// SPLIT-SCREEN TOUCH CONTROLS WITH TAP/HOLD
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
            // Left half: Movement
            if (leftTouchId === null) {
                leftTouchId = touch.identifier;
                leftTouchStart.x = touch.clientX;
                leftTouchStart.y = touch.clientY;
            }
        } else {
            // Right half: Look & Mine/Place
            if (rightTouchId === null) {
                rightTouchId = touch.identifier;
                rightTouchPrev.x = touch.clientX;
                rightTouchPrev.y = touch.clientY;
                rightTouchStartTime = Date.now();
                rightTouchMoved = false;

                // Start hold timer for continuous mining (triggers after 250ms hold)
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
            
            // If thumb moves more than 5px, mark as drag (cancels tap-to-place)
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                rightTouchMoved = true;
                clearTimeout(holdTimer); // Cancel hold-to-mine if moving camera
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

            // If thumb didn't move and touch was short (< 250ms), register as a PLACE block tap
            const touchDuration = Date.now() - rightTouchStartTime;
            if (!rightTouchMoved && touchDuration < 250) {
                raycastAction('place');
            }
        }
    }
};

window.addEventListener('touchend', handleTouchEnd);
window.addEventListener('touchcancel', handleTouchEnd);

// ==========================================
// SCALED PLAYER PHYSICS & MULTI-POINT COLLISION
// ==========================================
let yaw = 0, pitch = 0;
const playerVelocity = new THREE.Vector3();
let playerOnGround = false;

function isSolidBlock(x, y, z) {
    const blockID = getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return blockID !== 0;
}

function updatePlayer() {
    if (!window.playerSpawned) return; 

    // Apply rotation from touch inputs
    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    const speed = isFreeCam ? 0.60 : 0.20; 

    // ------------------------------------------
    // FREE CAM LOGIC (No clip, full flight)
    // ------------------------------------------
    if (isFreeCam) {
        // Get true forward vector based on where camera is physically looking (includes pitch)
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        
        const moveDir = new THREE.Vector3();
        // -moveVector.y translates dragging UP to moving FORWARD
        moveDir.addScaledVector(forward, -moveVector.y * speed);
        moveDir.addScaledVector(side, moveVector.x * speed);

        camera.position.add(moveDir);
        return; // Exit function completely to skip gravity and collisions
    }

    // ------------------------------------------
    // STANDARD WALKING LOGIC
    // ------------------------------------------
    // Ignore pitch for walking (only horizontal direction matters)
    const walkForward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    const walkSide = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();

    const moveDir = new THREE.Vector3();
    moveDir.addScaledVector(walkForward, -moveVector.y * speed);
    moveDir.addScaledVector(walkSide, moveVector.x * speed);

    // Gravity
    playerVelocity.y = Math.max(-0.5, playerVelocity.y - 0.025);

    const nextX = camera.position.x + moveDir.x;
    const nextZ = camera.position.z + moveDir.z;
    const radius = 0.35; 

    let eyeY = camera.position.y;
    let feetY = eyeY - 5.4;
    const STEP_HEIGHT = 1.05; 

    const checkCollisionAtY = (testY) => {
        let collideX = false, collideZ = false;
        for (let checkY = testY; checkY <= testY + 5.0; checkY += 1.5) {
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
    const newFeetY = camera.position.y - 5.5;

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
        camera.position.y = Math.floor(newFeetY) + 1 + 5.5;
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
