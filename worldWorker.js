// ==========================================
// WORLD WORKER (BACKGROUND THREAD)
// ==========================================
importScripts('https://cdnjs.cloudflare.com/ajax/libs/simplex-noise/2.4.0/simplex-noise.min.js');

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const simplex = new SimplexNoise();

function getIndex(x, y, z) {
    return x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
}

function generateChunkData(cx, cz) {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;

            // Heightmap calculation
            let height = Math.floor(30 + simplex.noise2D(wx * 0.015, wz * 0.015) * 18);

            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                let block = 0;

                if (y <= height) {
                    if (y === height) {
                        block = (height < 28) ? 4 : 1; 
                    } else if (y > height - 4) {
                        block = (height < 28) ? 4 : 2; 
                    } else {
                        block = 5; // Stone
                    }

                    // --- WIDER CAVE CARVING ---
                    // Lowered noise frequency (0.018 vs 0.03) and opened threshold range (0.16)
                    // Makes caverns roughly 12-18ft wide instead of tight 3ft crawling tunnels
                    let caveNoise = simplex.noise3D(wx * 0.018, y * 0.022, wz * 0.018);
                    if (Math.abs(caveNoise) < 0.16 && y < height - 3 && y > 3) {
                        block = 0; // Air gap for cave
                    }
                }
                
                const existingIdx = getIndex(x, y, z);
                if (data[existingIdx] === 0) {
                    data[existingIdx] = block;
                }
            }

            // High-res Procedural Tree Placement
            if (height >= 28 && Math.abs(simplex.noise2D(wx * 0.85, wz * 0.85)) > 0.82) {
                const trunkHeight = Math.floor(9 + Math.random() * 4);
                
                for (let ty = 1; ty <= trunkHeight; ty++) {
                    if (height + ty < CHUNK_HEIGHT) {
                        data[getIndex(x, height + ty, z)] = 3; 
                    }
                }

                const canopyCenterY = height + trunkHeight;
                const radius = 3;

                for (let lx = -radius; lx <= radius; lx++) {
                    for (let lz = -radius; lz <= radius; lz++) {
                        for (let ly = -radius; ly <= radius + 1; ly++) {
                            const distSq = (lx * lx) + (ly * ly * 0.8) + (lz * lz);
                            if (distSq <= (radius * radius) + 0.5) {
                                let tx = x + lx;
                                let tz = z + lz;
                                let ty = canopyCenterY + ly;

                                if (tx >= 0 && tx < CHUNK_SIZE && tz >= 0 && tz < CHUNK_SIZE && ty > 0 && ty < CHUNK_HEIGHT) {
                                    let idx = getIndex(tx, ty, tz);
                                    if (data[idx] === 0) {
                                        data[idx] = 6; 
                                    }
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

// Listen for messages from the main thread (game.js)
self.onmessage = function (e) {
    const { cx, cz } = e.data;
    const data = generateChunkData(cx, cz);
    
    // Transfer raw buffer array back to main thread zero-copy
    self.postMessage({ cx, cz, data: data.buffer }, [data.buffer]);
};
