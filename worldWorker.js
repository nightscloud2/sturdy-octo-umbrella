// ==========================================
// WORLD WORKER (STANDALONE NO DEPENDENCIES)
// ==========================================
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;

// Simple, fast deterministic 2D/3D PRNG noise for worker
function pseudoNoise2D(x, z) {
    let n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

function pseudoNoise3D(x, y, z) {
    let n = Math.sin(x * 12.9898 + y * 45.164 + z * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
}

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
            let height = Math.floor(30 + pseudoNoise2D(wx * 0.05, wz * 0.05) * 14);

            for (let y = 0; y < CHUNK_HEIGHT; y++) {
                let block = 0;

                if (y <= height) {
                    if (y === height) {
                        block = (height < 28) ? 4 : 1; 
                    } else if (y > height - 4) {
                        block = (height < 28) ? 4 : 2; 
                    } else {
                        block = 5; 
                    }

                    // Spacious caves
                    let cave = pseudoNoise3D(wx * 0.08, y * 0.08, wz * 0.08);
                    if (Math.abs(cave) < 0.25 && y < height - 3 && y > 3) {
                        block = 0; // Cave air gap
                    }
                }
                
                const existingIdx = getIndex(x, y, z);
                if (data[existingIdx] === 0) {
                    data[existingIdx] = block;
                }
            }

            // High-res Procedural Trees
            if (height >= 28 && pseudoNoise2D(wx * 0.8, wz * 0.8) > 0.8) {
                const trunkHeight = Math.floor(9 + pseudoNoise2D(wx, wz) * 4);
                
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

self.onmessage = function (e) {
    const { cx, cz } = e.data;
    const data = generateChunkData(cx, cz);
    self.postMessage({ cx, cz, data: data.buffer }, [data.buffer]);
};
