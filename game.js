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
    // Set camera to first-person order so looking up/down doesn't tilt the horizon
    camera.rotation.order = 'YXZ'; 
    camera.position.set(8, 22, 8); // Start in the middle of the chunk, high up

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(20, 50, 20);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x606060));

    // ==========================================
    // 3. THE VOXEL ENGINE: Noise & Data
    // ==========================================
    const chunkSize = 16;
    const chunkHeight = 32; 

    const blocks = new Uint8Array(chunkSize * chunkHeight * chunkSize);
    const simplex = new SimplexNoise(); 

    function getIndex(x, y, z) { return x + chunkSize * (y + chunkHeight * z); }
    function getBlock(x, y, z) {
        if (x < 0 || x >= chunkSize || y < 0 || y >= chunkHeight || z < 0 || z >= chunkSize) return 0;
        return blocks[getIndex(x, y, z)];
    }

    // Generate terrain with distinct layers (Grass vs Dirt)
    for (let x = 0; x < chunkSize; x++) {
        for (let z = 0; z < chunkSize; z++) {
            const scale = 0.08; 
            const rawNoise = simplex.noise2D(x * scale, z * scale);
            const surfaceHeight = Math.floor((rawNoise + 1) * 0.5 * 10) + 10; 

            for (let y = 0; y < chunkHeight; y++) {
                if (y === surfaceHeight) {
                    blocks[getIndex(x, y, z)] = 1; // ID 1 = Grass Block
                } else if (y < surfaceHeight) {
                    blocks[getIndex(x, y, z)] = 2; // ID 2 = Dirt Block
                } else {
                    blocks[getIndex(x, y, z)] = 0; // ID 0 = Air
                }
            }
        }
    }

    // ==========================================
    // 4. THE MESHER: Vertex Colors & Geometry
    // ==========================================
    const vertices = [];
    const normals = [];
    const colors = []; // NEW: Array to hold face colors!

    const faceData = [
        { dir: [1, 0, 0], corners: [[1,0,1], [1,0,0], [1,1,0], [1,1,0], [1,1,1], [1,0,1]], norm: [1,0,0] },
        { dir: [-1, 0, 0], corners: [[0,0,0], [0,0,1], [0,1,1], [0,1,1], [0,1,0], [0,0,0]], norm: [-1,0,0] },
        { dir: [0, 1, 0], corners: [[0,1,1], [1,1,1], [1,1,0], [1,1,0], [0,1,0], [0,1,1]], norm: [0,1,0] }, // TOP FACE
        { dir: [0, -1, 0], corners: [[0,0,0], [1,0,0], [1,0,1], [1,0,1], [0,0,1], [0,0,0]], norm: [0,-1,0] },
        { dir: [0, 0, 1], corners: [[0,0,1], [1,0,1], [1,1,1], [1,1,1], [0,1,1], [0,0,1]], norm: [0,0,1] },
        { dir: [0, 0, -1], corners: [[1,0,0], [0,0,0], [0,1,0], [0,1,0], [1,1,0], [1,0,0]], norm: [0,0,-1] }
    ];

    for (let x = 0; x < chunkSize; x++) {
        for (let y = 0; y < chunkHeight; y++) {
            for (let z = 0; z < chunkSize; z++) {
                const blockID = getBlock(x, y, z);
                if (blockID === 0) continue;

                for (const face of faceData) {
                    const neighbor = getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
                    if (neighbor === 0) {
                        
                        // Determine Color based on Block ID and Face Direction
                        let r, g, b;
                        if (blockID === 1) { // Grass Block
                            if (face.dir[1] === 1) { 
                                // Top face is green
                                r = 0.2; g = 0.8; b = 0.2; 
                            } else {
                                // Sides/Bottom of grass block are brown dirt
                                r = 0.4; g = 0.25; b = 0.1; 
                            }
                        } else if (blockID === 2) { // Dirt Block
                            // All faces are brown
                            r = 0.4; g = 0.25; b = 0.1;
                        }

                        for (const corner of face.corners) {
                            vertices.push(x + corner[0], y + corner[1], z + corner[2]);
                            normals.push(...face.norm);
                            colors.push(r, g, b); // Push the color for this vertex
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

    // Notice: vertexColors is set to true, and base color is white so it doesn't tint!
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 });
    const chunkMesh = new THREE.Mesh(geometry, material);
    scene.add(chunkMesh);

    // ==========================================
    // 5. MOBILE CONTROLS (UI & Touch Listeners)
    // ==========================================
    
    // Inject a Walk Button into the screen
    const walkBtn = document.createElement('button');
    walkBtn.innerText = "WALK";
    walkBtn.style.cssText = "position:absolute; bottom:40px; left:50%; transform:translateX(-50%); width:100px; height:100px; border-radius:50px; background:rgba(255,255,255,0.4); border:2px solid white; color:black; font-size:20px; font-weight:bold; touch-action:none; user-select:none; z-index:100;";
    document.body.appendChild(walkBtn);

    let isWalking = false;
    walkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isWalking = true; }, {passive: false});
    walkBtn.addEventListener('touchend', (e) => { e.preventDefault(); isWalking = false; }, {passive: false});

    // Touch-Drag to Look Around
    let isDragging = false;
    let previousTouch = null;
    let yaw = 0;   // Left/Right rotation
    let pitch = 0; // Up/Down rotation

    window.addEventListener('touchstart', (e) => {
        if (e.target === walkBtn) return; // Ignore if touching the walk button
        isDragging = true;
        previousTouch = e.touches[0];
    }, {passive: false});

    window.addEventListener('touchmove', (e) => {
        if (!isDragging || e.target === walkBtn) return;
        e.preventDefault(); // Stop screen from scrolling/pulling down
        
        const touch = e.touches[0];
        const deltaX = touch.pageX - previousTouch.pageX;
        const deltaY = touch.pageY - previousTouch.pageY;

        yaw -= deltaX * 0.005; 
        pitch -= deltaY * 0.005;
        
        // Clamp pitch so you can't break your neck looking too far up/down
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)); 

        previousTouch = touch;
    }, {passive: false});

    window.addEventListener('touchend', () => { isDragging = false; });

    // Handle screen rotation/resizing
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ==========================================
    // 6. Game Loop
    // ==========================================
    function animate() {
        requestAnimationFrame(animate);

        // Apply looking rotation
        camera.rotation.y = yaw;
        camera.rotation.x = pitch;

        // Apply walking movement
        if (isWalking) {
            const speed = 0.1;
            // Calculate which way is "forward" based on where you are looking
            const direction = new THREE.Vector3(0, 0, -1);
            direction.applyQuaternion(camera.quaternion);
            
            // Flatten the vector so you walk horizontally, not fly into the sky
            direction.y = 0; 
            direction.normalize(); 
            
            camera.position.addScaledVector(direction, speed);
        }

        renderer.render(scene, camera);
    }
    animate();
                         }
