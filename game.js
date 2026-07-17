// 1. Setup the Scene
const scene = new THREE.Scene();

// 2. Setup the Camera (Pulled back and up a bit to see the full body)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 3, 8); 
camera.lookAt(0, 1.5, 0);

// 3. Setup the WebGL Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 4. Create the Humanoid Avatar using a Group
const avatar = new THREE.Group(); // The master container for our body parts

// Set up a few different materials (colors) for clothes/skin
const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xffccaa, roughness: 0.5 });
const shirtMaterial = new THREE.MeshStandardMaterial({ color: 0x0055ff, roughness: 0.6 });
const pantsMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });

// Torso (Width, Height, Depth)
const torso = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.5), shirtMaterial);
torso.position.y = 1.5; // Lift up off the floor
avatar.add(torso);      // Attach to the group

// Head
const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), skinMaterial);
head.position.y = 2.8; // Place on top of the torso
avatar.add(head);

// Left & Right Arms
const armGeo = new THREE.BoxGeometry(0.4, 1.4, 0.4);
const leftArm = new THREE.Mesh(armGeo, skinMaterial);
leftArm.position.set(-0.8, 1.5, 0); // Shift left
avatar.add(leftArm);

const rightArm = new THREE.Mesh(armGeo, skinMaterial);
rightArm.position.set(0.8, 1.5, 0); // Shift right
avatar.add(rightArm);

// Left & Right Legs
const legGeo = new THREE.BoxGeometry(0.45, 1.5, 0.45);
const leftLeg = new THREE.Mesh(legGeo, pantsMaterial);
leftLeg.position.set(-0.3, 0.25, 0); // Shift slightly left, lower down
avatar.add(leftLeg);

const rightLeg = new THREE.Mesh(legGeo, pantsMaterial);
rightLeg.position.set(0.3, 0.25, 0); // Shift slightly right, lower down
avatar.add(rightLeg);

// Add the fully assembled humanoid to the scene
scene.add(avatar);

// 5. Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); 
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
sunLight.position.set(5, 10, 7);
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

    // Spin the master group, so all body parts rotate together!
    avatar.rotation.y += 0.01; 

    renderer.render(scene, camera);
}

animate();
