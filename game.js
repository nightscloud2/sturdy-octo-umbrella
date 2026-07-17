// 1. Setup the Scene
const scene = new THREE.Scene();

// 2. Setup the Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5); // Position camera slightly up and back
camera.lookAt(0, 0, 0);       // Point the camera at the center

// 3. Setup the WebGL Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 4. Create the Solid Avatar Cube
const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
const material = new THREE.MeshStandardMaterial({ 
    color: 0x00ffcc,
    roughness: 0.4, // Makes it slightly shiny
    metalness: 0.1
});
const avatar = new THREE.Mesh(geometry, material);
scene.add(avatar);

// 5. ADD LIGHTS (Crucial for Standard Material)
// Ambient Light: Softly illuminates all sides equally so dark sides aren't pitch black
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); 
scene.add(ambientLight);

// Directional Light: Acts like the sun, casting distinct highlights and angles
const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
sunLight.position.set(5, 10, 7); // Positioned above, to the right, and forward
scene.add(sunLight);

// 6. Handle Window Resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// 7. The Animation Loop
function animate() {
    requestAnimationFrame(animate);

    // Keep it spinning slowly so we can see the light reflecting off the edges
    avatar.rotation.y += 0.01;

    renderer.render(scene, camera);
}

animate();
