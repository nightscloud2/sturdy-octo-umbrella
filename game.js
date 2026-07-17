// 1. Setup the Scene
const scene = new THREE.Scene();

// 2. Setup the Camera (Field of View, Aspect Ratio, Near clipping, Far clipping)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5; // Pull the camera back so we can see the center

// 3. Setup the WebGL Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement); // Inject the canvas into the HTML

// 4. Create the 3D Object (Geometry + Material = Mesh)
const geometry = new THREE.BoxGeometry(2, 2, 2); // Width, height, depth
const material = new THREE.MeshBasicMaterial({ 
    color: 0x00ffcc, // A nice vibrant cyan
    wireframe: true  // Shows the structural triangles/lines of the 3D grid
});
const cube = new THREE.Mesh(geometry, material);
scene.add(cube); // Place the cube into our 3D world

// 5. Handle Window Resizing (Keeps aspect ratio perfect if user scales browser)
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// 6. The Animation/Render Loop
function animate() {
    requestAnimationFrame(animate); // Tells the browser to loop this at 60+ FPS

    // Rotate the cube on every single frame
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;

    // Render the updated scene from the perspective of our camera
    renderer.render(scene, camera);
}

// Fire up the loop!
animate();
