// 1. Setup Scene, Camera, Renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(24, 24, 24); 
camera.lookAt(8, 8, 8); // Look at the center of our chunk

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Add a light so we can see the geometry
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(10, 20, 10);
scene.add(light);
scene.add(new THREE.AmbientLight(0x404040));

// ==========================================
// 2. THE VOXEL ENGINE: Data Structure
// ==========================================
const chunkSize = 16;
const chunkHeight = 16;

// A flat array is much faster in JavaScript than a nested 3D array [x][y][z]
const blocks = new Uint8Array(chunkSize * chunkHeight * chunkSize);

// Helper function to find a block's index in the flat array
function getIndex(x, y, z) {
    return x + chunkSize * (y + chunkHeight * z);
}

// Helper function to safely check a block (returns 0 for air if outside chunk)
function getBlock(x, y, z) {
    if (x < 0 || x >= chunkSize || y < 0 || y >= chunkHeight || z < 0 || z >= chunkSize) {
        return 0; // Treat boundaries as air so outer faces render
    }
    return blocks[getIndex(x, y, z)];
}

// Fill the chunk with some test data (a solid cube missing a few random blocks)
for (let x = 0; x < chunkSize; x++) {
    for (let y = 0; y < chunkHeight; y++) {
        for (let z = 0; z < chunkSize; z++) {
            // Let's make it solid, but randomly carve out some air (0) to test culling
            blocks[getIndex(x, y, z)] = Math.random() > 0.1 ? 1 : 0; 
        }
    }
}

// ==========================================
// 3. THE MESHER: Face Culling & Geometry
// ==========================================
const vertices = [];
const normals = [];

// The 6 faces of a cube. Each face is made of 2 triangles (6 vertices total)
const faceData = [
    { dir: [1, 0, 0], corners: [[1,0,1], [1,0,0], [1,1,0], [1,1,0], [1,1,1], [1,0,1]], norm: [1,0,0] }, // Right
    { dir: [-1, 0, 0], corners: [[0,0,0], [0,0,1], [0,1,1], [0,1,1], [0,1,0], [0,0,0]], norm: [-1,0,0] }, // Left
    { dir: [0, 1, 0], corners: [[0,1,1], [1,1,1], [1,1,0], [1,1,0], [0,1,0], [0,1,1]], norm: [0,1,0] }, // Top
    { dir: [0, -1, 0], corners: [[0,0,0], [1,0,0], [1,0,1], [1,0,1], [0,0,1], [0,0,0]], norm: [0,-1,0] }, // Bottom
    { dir: [0, 0, 1], corners: [[0,0,1], [1,0,1], [1,1,1], [1,1,1], [0,1,1], [0,0,1]], norm: [0,0,1] }, // Front
    { dir: [0, 0, -1], corners: [[1,0,0], [0,0,0], [0,1,0], [0,1,0], [1,1,0], [1,0,0]], norm: [0,0,-1] }  // Back
];

// Loop through every single block in our 3D grid
for (let x = 0; x < chunkSize; x++) {
    for (let y = 0; y < chunkHeight; y++) {
        for (let z = 0; z < chunkSize; z++) {
            
            // If the block is air (0), skip it!
            if (getBlock(x, y, z) === 0) continue;

            // Check all 6 neighbors. If a neighbor is air, build that face!
            for (const face of faceData) {
                const neighbor = getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
                
                if (neighbor === 0) {
                    // Push the 6 vertices for this face
                    for (const corner of face.corners) {
                        vertices.push(x + corner[0], y + corner[1], z + corner[2]);
                        normals.push(...face.norm);
                    }
                }
            }
        }
    }
}

// 4. Construct the final Three.js Mesh
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

// Use a basic green material to look like a grass chunk
const material = new THREE.MeshStandardMaterial({ color: 0x228b22, roughness: 0.8 });
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

// Let's orbit the camera slowly so you can see the culling in action
let angle = 0;
function animate() {
    requestAnimationFrame(animate);

    angle += 0.005;
    camera.position.x = 8 + Math.cos(angle) * 24;
    camera.position.z = 8 + Math.sin(angle) * 24;
    camera.lookAt(8, 8, 8);

    renderer.render(scene, camera);
}
animate();
