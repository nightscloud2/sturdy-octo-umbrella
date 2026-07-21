// 1. Dynamically load the Simplex Noise library so we don't have to touch index.html
const script = document.createElement('script');
script.src = 'https://cdnjs.cloudflare.com/ajax/libs/simplex-noise/2.4.0/simplex-noise.min.js';
script.onload = startEngine; // Only start the game once the math library is loaded!
document.head.appendChild(script);

function startEngine() {
    // ==========================================
    // 2. Setup Scene, Camera, Renderer
    // ==========================================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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
    const chunkHeight = 32; // Increased height so we have room for taller hills

    const blocks = new Uint8Array(chunkSize * chunkHeight * chunkSize);
    const simplex = new SimplexNoise(); // Initialize our math map

    function getIndex(x, y, z) {
        return x + chunkSize * (y + chunkHeight * z);
    }

    function getBlock(x, y, z) {
        if (x < 0 || x >= chunkSize || y < 0 || y >= chunkHeight || z < 0 || z >= chunkSize) return 0;
        return blocks[getIndex(x, y, z)];
    }

    // Generate terrain using the noise map!
    for (let x = 0; x < chunkSize; x++) {
        for (let z = 0; z < chunkSize; z++) {
            
            // "Zoom" into the noise map. Lower number = smoother, wider hills.
            const scale = 0.08; 
            
            // noise2D returns a value between -1.0 and 1.0. 
            const rawNoise = simplex.noise2D(x * scale, z * scale);
            
            // Convert that -1 to 1 range into a block height between 10 and 20
            const surfaceHeight = Math.floor((rawNoise + 1) * 0.5 * 10) + 10; 

            for (let y = 0; y < chunkHeight; y++) {
                if (y <= surfaceHeight) {
                    blocks[getIndex(x, y, z)] = 1; // Solid Block
                } else {
                    blocks[getIndex(x, y, z)] = 0; // Air
                }
            }
        }
    }

    // ==========================================
    // 4. THE MESHER: Face Culling & Geometry
    // ==========================================
    const vertices = [];
    const normals = [];

    const faceData = [
        { dir: [1, 0, 0], corners: [[1,0,1], [1,0,0], [1,1,0], [1,1,0], [1,1,1], [1,0,1]], norm: [1,0,0] },
        { dir: [-1, 0, 0], corners: [[0,0,0], [0,0,1], [0,1,1], [0,1,1], [0,1,0], [0,0,0]], norm: [-1,0,0] },
        { dir: [0, 1, 0], corners: [[0,1,1], [1,1,1], [1,1,0], [1,1,0], [0,1,0], [0,1,1]], norm: [0,1,0] },
        { dir: [0, -1, 0], corners: [[0,0,0], [1,0,0], [1,0,1], [1,0,1], [0,0,1], [0,0,0]], norm: [0,-1,0] },
        { dir: [0, 0, 1], corners: [[0,0,1], [1,0,1], [1,1,1], [1,1,1], [0,1,1], [0,0,1]], norm: [0,0,1] },
        { dir: [0, 0, -1], corners: [[1,0,0], [0,0,0], [0,1,0], [0,1,0], [1,1,0], [1,0,0]], norm: [0,0,-1] }
    ];

    for (let x = 0; x < chunkSize; x++) {
        for (let y = 0; y < chunkHeight; y++) {
            for (let z = 0; z < chunkSize; z++) {
                
                if (getBlock(x, y, z) === 0) continue;

                for (const face of faceData) {
                    const neighbor = getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
                    if (neighbor === 0) {
                        for (const corner of face.corners) {
                            vertices.push(x + corner[0], y + corner[1], z + corner[2]);
                            normals.push(...face.norm);
                        }
                    }
                }
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    const material = new THREE.MeshStandardMaterial({ color: 0x228b22, roughness: 0.9 });
    const chunkMesh = new THREE.Mesh(geometry, material);
    scene.add(chunkMesh);

    // ==========================================
    // 5. Game Loop & Window Resizing
    // ==========================================
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    let angle = 0;
    function animate() {
        requestAnimationFrame(animate);

        // Orbit camera around the generated terrain
        angle += 0.005;
        camera.position.x = 8 + Math.cos(angle) * 35;
        camera.position.y = 25; // Hold camera slightly above the terrain
        camera.position.z = 8 + Math.sin(angle) * 35;
        camera.lookAt(8, 10, 8);

        renderer.render(scene, camera);
    }
    animate();
}
