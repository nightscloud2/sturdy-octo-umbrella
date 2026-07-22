// 1. Dynamically load the Simplex Noise library
const script = document.createElement('script');
script.src = 'https://cdnjs.cloudflare.com/ajax/libs/simplex-noise/2.4.0/simplex-noise.min.js';
script.onload = startEngine; 
document.head.appendChild(script);

function startEngine() {
    // ==========================================
    // 2. Setup Scene, Camera, Renderer
    // ==========================================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.rotation.order = 'YXZ'; 
    // Start the camera nicely in the center of our multi-chunk world
    camera.position.set(24, 25, 24); 

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(40, 80, 40);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x606060));

    // ==========================================
    // 3. MULTI-CHUNK DATA STRUCTURE & CAVE NOISE
    // ==========================================
    const chunkSize = 16;
    const chunkHeight = 32; 
    
    // Dictionary to store chunks by key string "cx,cz"
    const chunks = new Map();
    const simplex = new SimplexNoise(); 

    function getChunkKey(cx, cz) {
        return `${cx},${cz}`;
    }

    // Generate a single chunk's block data using 2D terrain + 3D cave noise
    function generateChunkData(cx, cz) {
        const blocks = new Uint8Array(chunkSize * chunkHeight * chunkSize);
        
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                // Absolute world space for smooth noise continuation across chunk lines
                const worldX = (cx * chunkSize) + x;
                const worldZ = (cz * chunkSize) + z;

                // 2D Surface Noise (Rolling Hills)
                const surfaceScale = 0.05; 
                const rawNoise2D = simplex.noise2D(worldX * surfaceScale, worldZ * surfaceScale);
                const surfaceHeight = Math.floor((rawNoise2D + 1) * 0.5 * 10) + 10; 

                for (let y = 0; y < chunkHeight; y++) {
                    const index = x + chunkSize * (y + chunkHeight * z);
                    const worldY = y;
                    
                    let blockID = 0;
                    if (y === surfaceHeight) {
                        blockID = 1; // Grass
                    } else if (y < surfaceHeight) {
                        blockID = 2; // Dirt
                    }

                    // 3D Cave Carving (Worm caves)
                    if (blockID !== 0) { 
                        const caveScale = 0.08; // Cave tunnel frequency
                        const caveDensity = simplex.noise3D(worldX * caveScale, worldY * caveScale, worldZ * caveScale);
                        
                        // Carve out a tunnel if noise is close to zero
                        if (Math.abs(caveDensity) < 0.1) {
                            blockID = 0; // Turn to air
                        }
                    }

                    // Bedrock floor (prevents falling through the map bottom)
                    if (y === 0) blockID = 2; 

                    blocks[index] = blockID;
                }
            }
        }
        return blocks;
    }

    // Global block lookup that checks across loaded chunks
    function getBlock(worldX, worldY, worldZ) {
        if (worldY < 0 || worldY >= chunkHeight) return 0;

        const cx = Math.floor(worldX / chunkSize);
        const cz = Math.floor(worldZ / chunkSize);
        const chunkKey = getChunkKey(cx, cz);

        if (!chunks.has(chunkKey)) return 0; // Out of bounds / unloaded

        const chunkData = chunks.get(chunkKey).data;
        const localX = worldX - (cx * chunkSize);
        const localZ = worldZ - (cz * chunkSize);

        return chunkData[localX + chunkSize * (worldY + chunkHeight * localZ)];
    }

    function setBlock(worldX, worldY, worldZ, blockID) {
        if (worldY < 0 || worldY >= chunkHeight) return;

        const cx = Math.floor(worldX / chunkSize);
        const cz = Math.floor(worldZ / chunkSize);
        const chunkKey = getChunkKey(cx, cz);

        if (!chunks.has(chunkKey)) return;

        const chunkData = chunks.get(chunkKey).data;
        const localX = worldX - (cx * chunkSize);
        const localZ = worldZ - (cz * chunkSize);

        chunkData[localX + chunkSize * (worldY + chunkHeight * localZ)] = blockID;
    }

    // ==========================================
    // 4. THE MESHER: Chunk Mesh Builder
    // ==========================================
    const faceData = [
        { dir: [1, 0, 0], corners: [[1,0,1], [1,0,0], [1,1,0], [1,1,0], [1,1,1], [1,0,1]], norm: [1,0,0] },
        { dir: [-1, 0, 0], corners: [[0,0,0], [0,0,1], [0,1,1], [0,1,1], [0,1,0], [0,0,0]], norm: [-1,0,0] },
        { dir: [0, 1, 0], corners: [[0,1,1], [1,1,1], [1,1,0], [1,1,0], [0,1,0], [0,1,1]], norm: [0,1,0] },
        { dir: [0, -1, 0], corners: [[0,0,0], [1,0,0], [1,0,1], [1,0,1], [0,0,1], [0,0,0]], norm: [0,-1,0] },
        { dir: [0, 0, 1], corners: [[0,0,1], [1,0,1], [1,1,1], [1,1,1], [0,1,1], [0,0,1]], norm: [0,0,1] },
        { dir: [0, 0, -1], corners: [[1,0,0], [0,0,0], [0,1,0], [0,1,0], [1,1,0], [1,0,0]], norm: [0,0,-1] }
    ];

    function buildChunkMesh(cx, cz) {
        const chunkKey = getChunkKey(cx, cz);
        const chunk = chunks.get(chunkKey);
        if (!chunk) return;

        // Clean up existing mesh from scene
        if (chunk.mesh) {
            scene.remove(chunk.mesh);
            chunk.mesh.geometry.dispose();
            chunk.mesh.material.dispose();
        }

        const vertices = [];
        const normals = [];
        const colors = []; 

        const startX = cx * chunkSize;
        const startZ = cz * chunkSize;

        for (let x = 0; x < chunkSize; x++) {
            for (let y = 0; y < chunkHeight; y++) {
                for (let z = 0; z < chunkSize; z++) {
                    const blockID = chunk.data[x + chunkSize * (y + chunkHeight * z)];
                    if (blockID === 0) continue;

                    const worldX = startX + x;
                    const worldZ = startZ + z;

                    for (const face of faceData) {
                        // Check neighbors globally across chunk boundaries
                        const neighbor = getBlock(worldX + face.dir[0], y + face.dir[1], worldZ + face.dir[2]);
                        
                        if (neighbor === 0) {
                            let r, g, b;
                            if (blockID === 1) { // Grass
                                if (face.dir[1] === 1) { r = 0.3; g = 0.8; b = 0.3; } 
                                else { r = 0.4; g = 0.25; b = 0.1; }
                            } else if (blockID === 2) { // Dirt
                                r = 0.4; g = 0.25; b = 0.1;
                            } else if (blockID === 3) { // Placed Wood
                                r = 0.8; g = 0.6; b = 0.4;
                            }

                            // Directional Notch Shading
                            let shade = 1.0;
                            if (face.dir[1] === -1) shade = 0.5;      
                            else if (face.dir[0] !== 0) shade = 0.7;  
                            else if (face.dir[2] !== 0) shade = 0.85; 

                            r *= shade; g *= shade; b *= shade;

                            for (const corner of face.corners) {
                                vertices.push(x + corner[0], y + corner[1], z + corner[2]);
                                normals.push(...face.norm);
                                colors.push(r, g, b); 
                            }
                        }
                    }
                }
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.MeshLambertMaterial({ vertexColors: true });
        chunk.mesh = new THREE.Mesh(geometry, material);
        chunk.mesh.position.set(startX, 0, startZ);
        scene.add(chunk.mesh);
    }

    // Generate 3x3 Grid of Chunks (-1 to 1 radius)
    const renderRadius = 1;
    for (let cx = -renderRadius; cx <= renderRadius; cx++) {
        for (let cz = -renderRadius; cz <= renderRadius; cz++) {
            const key = getChunkKey(cx, cz);
            chunks.set(key, { data: generateChunkData(cx, cz), mesh: null });
            buildChunkMesh(cx, cz);
        }
    }

    // ==========================================
    // 5. MOBILE CONTROLS & UI
    // ==========================================
    const walkBtn = document.createElement('button');
    walkBtn.innerText = "WALK";
    walkBtn.style.cssText = "position:absolute; bottom:40px; left:50%; transform:translateX(-50%); width:90px; height:90px; border-radius:45px; background:rgba(255,255,255,0.4); border:2px solid white; color:black; font-size:18px; font-weight:bold; touch-action:none; user-select:none; z-index:100;";
    document.body.appendChild(walkBtn);

    const jumpBtn = document.createElement('button');
    jumpBtn.innerText = "JUMP";
    jumpBtn.style.cssText = "position:absolute; bottom:40px; right:20px; width:80px; height:80px; border-radius:40px; background:rgba(255,255,255,0.4); border:2px solid white; color:black; font-size:16px; font-weight:bold; touch-action:none; user-select:none; z-index:100;";
    document.body.appendChild(jumpBtn);

    let buildMode = "MINE"; 
    const modeBtn = document.createElement('button');
    modeBtn.innerText = "MODE: MINE";
    modeBtn.style.cssText = "position:absolute; top:20px; right:20px; width:120px; height:50px; background:rgba(255,0,0,0.5); border:2px solid white; color:white; font-weight:bold; z-index:100; border-radius:10px;";
    document.body.appendChild(modeBtn);

    const crosshair = document.createElement('div');
    crosshair.innerText = "+";
    crosshair.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:rgba(255,255,255,0.8); font-size:30px; font-family:monospace; pointer-events:none; z-index:100; text-shadow: 1px 1px 2px black;";
    document.body.appendChild(crosshair);

    modeBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (buildMode === "MINE") {
            buildMode = "PLACE";
            modeBtn.innerText = "MODE: PLACE";
            modeBtn.style.background = "rgba(0,255,0,0.5)";
        } else {
            buildMode = "MINE";
            modeBtn.innerText = "MODE: MINE";
            modeBtn.style.background = "rgba(255,0,0,0.5)";
        }
    }, {passive: false});

    let isWalking = false;
    walkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isWalking = true; }, {passive: false});
    walkBtn.addEventListener('touchend', (e) => { e.preventDefault(); isWalking = false; }, {passive: false});

    let isDragging = false;
    let previousTouch = null;
    let dragDistance = 0;
    let yaw = 0;   
    let pitch = 0; 

    window.addEventListener('touchstart', (e) => {
        if (e.target === walkBtn || e.target === jumpBtn || e.target === modeBtn) return; 
        isDragging = true;
        previousTouch = e.touches[0];
        dragDistance = 0;
    }, {passive: false});

    window.addEventListener('touchmove', (e) => {
        if (!isDragging || e.target === walkBtn || e.target === jumpBtn || e.target === modeBtn) return;
        e.preventDefault(); 
        
        const touch = e.touches[0];
        const deltaX = touch.pageX - previousTouch.pageX;
        const deltaY = touch.pageY - previousTouch.pageY;

        dragDistance += Math.abs(deltaX) + Math.abs(deltaY);
        yaw -= deltaX * 0.005; 
        pitch -= deltaY * 0.005;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)); 

        previousTouch = touch;
    }, {passive: false});

    // ==========================================
    // 6. RAYCASTER (World Space)
    // ==========================================
    function raycast() {
        const rayStart = camera.position.clone();
        const rayDir = new THREE.Vector3(0, 0, -1);
        rayDir.applyQuaternion(camera.quaternion);

        const stepSize = 0.05;
        const maxDistance = 6.0; 
        let distanceTraveled = 0;

        const currentPos = rayStart.clone();
        let prevBx = Math.floor(currentPos.x);
        let prevBy = Math.floor(currentPos.y);
        let prevBz = Math.floor(currentPos.z);

        while (distanceTraveled < maxDistance) {
            currentPos.addScaledVector(rayDir, stepSize);
            distanceTraveled += stepSize;

            const bx = Math.floor(currentPos.x);
            const by = Math.floor(currentPos.y);
            const bz = Math.floor(currentPos.z);

            if (getBlock(bx, by, bz) !== 0) {
                return { 
                    breakTarget: { x: bx, y: by, z: bz },
                    placeTarget: { x: prevBx, y: prevBy, z: prevBz }
                }; 
            }
            prevBx = bx; prevBy = by; prevBz = bz;
        }
        return null; 
    }

    window.addEventListener('touchend', (e) => { 
        isDragging = false; 
        if (e.target === walkBtn || e.target === jumpBtn || e.target === modeBtn) return;
        
        if (dragDistance < 10) {
            const hit = raycast();
            if (hit) {
                let targetChunkX, targetChunkZ;

                if (buildMode === "MINE") {
                    const bx = hit.breakTarget.x;
                    const by = hit.breakTarget.y;
                    const bz = hit.breakTarget.z;
                    
                    setBlock(bx, by, bz, 0);
                    targetChunkX = Math.floor(bx / chunkSize);
                    targetChunkZ = Math.floor(bz / chunkSize);
                } 
                else if (buildMode === "PLACE") {
                    const px = hit.placeTarget.x;
                    const py = hit.placeTarget.y;
                    const pz = hit.placeTarget.z;
                    
                    setBlock(px, py, pz, 3); // Wood block
                    targetChunkX = Math.floor(px / chunkSize);
                    targetChunkZ = Math.floor(pz / chunkSize);
                }
                
                // Rebuild modified chunk mesh
                buildChunkMesh(targetChunkX, targetChunkZ);
            }
        }
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // --- PHYSICS VARIABLES ---
    let yVelocity = 0;
    const gravity = 0.015;
    const playerHeight = 1.5; 
    let isGrounded = false;

    jumpBtn.addEventListener('touchstart', (e) => { 
        e.preventDefault(); 
        if (isGrounded) {
            yVelocity = 0.25; 
            isGrounded = false;
        }
    }, {passive: false});

    // ==========================================
    // 7. Game Loop
    // ==========================================
    function animate() {
        requestAnimationFrame(animate);

        camera.rotation.y = yaw;
        camera.rotation.x = pitch;

        yVelocity -= gravity;
        camera.position.y += yVelocity;

        const feetY = camera.position.y - playerHeight;
        const currentBlockX = Math.floor(camera.position.x);
        const currentBlockZ = Math.floor(camera.position.z);

        if (getBlock(currentBlockX, Math.floor(feetY), currentBlockZ) !== 0) {
            camera.position.y = Math.floor(feetY) + 1 + playerHeight;
            yVelocity = 0;
            isGrounded = true;
        } else {
            isGrounded = false; 
        }

        if (isWalking) {
            const speed = 0.12;
            const direction = new THREE.Vector3(0, 0, -1);
            direction.applyQuaternion(camera.quaternion);
            direction.y = 0; 
            direction.normalize(); 
            
            const nextX = camera.position.x + direction.x * speed;
            const nextZ = camera.position.z + direction.z * speed;

            const checkY_feet = Math.floor(camera.position.y - playerHeight + 0.1); 
            const checkY_head = Math.floor(camera.position.y);
            
            const nextBlockX = Math.floor(nextX);
            const nextBlockZ = Math.floor(nextZ);

            if (getBlock(nextBlockX, checkY_feet, nextBlockZ) === 0 && 
                getBlock(nextBlockX, checkY_head, nextBlockZ) === 0) {
                camera.position.x = nextX;
                camera.position.z = nextZ;
            }
        }

        renderer.render(scene, camera);
    }
    animate();
            }
