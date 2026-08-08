// ==========================================
// WORLD WORKER (768 HEIGHT & DYNAMIC ALLOCATION)
// ==========================================
const CHUNK_SIZE = 16;
const MAX_HEIGHT = 768;
const SEA_LEVEL = 256;

function hash2D(x, z) {
    let n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

function hash3D(x, y, z) {
    let n = Math.sin(x * 12.9898 + y * 45.164 + z * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

function smoothNoise2D(x, z) {
    let ix = Math.floor(x), iz = Math.floor(z);
    let fx = x - ix, fz = z - iz;
    let ux = fx * fx * (3.0 - 2.0 * fx);
    let uz = fz * fz * (3.0 - 2.0 * fz);
    let v1 = hash2D(ix, iz), v2 = hash2D(ix + 1, iz);
    let v3 = hash2D(ix, iz + 1), v4 = hash2D(ix + 1, iz + 1);
    let i1 = v1 * (1.0 - ux) + v2 * ux;
    let i2 = v3 * (1.0 - ux) + v4 * ux;
    return i1 * (1.0 - uz) + i2 * uz;
}

function smoothNoise3D(x, y, z) {
    let ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    let ux = fx * fx * (3.0 - 2.0 * fx);
    let uy = fy * fy * (3.0 - 2.0 * fy);
    let uz = fz * fz * (3.0 - 2.0 * fz);
    let c000 = hash3D(ix, iy, iz), c100 = hash3D(ix+1, iy, iz);
    let c010 = hash3D(ix, iy+1, iz), c110 = hash3D(ix+1, iy+1, iz);
    let c001 = hash3D(ix, iy, iz+1), c101 = hash3D(ix+1, iy, iz+1);
    let c011 = hash3D(ix, iy+1, iz+1), c111 = hash3D(ix+1, iy+1, iz+1);
    let x00 = c000*(1-ux) + c100*ux;
    let x10 = c010*(1-ux) + c100*ux;
    let x01 = c001*(1-ux) + c101*ux;
    let x11 = c011*(1-ux) + c111*ux;
    let y0 = x00*(1-uy) + x10*uy;
    let y1 = x01*(1-uy) + x11*uy;
    return y0*(1-uz) + y1*uz; 
}

function getIndex(x, y, z) {
    return x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
}

function generateChunkData(cx, cz) {
    let localMaxY = SEA_LEVEL; 
    const heights = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;
            let height = Math.floor(180 + smoothNoise2D(wx * 0.015, wz * 0.015) * 140);
            heights[x + z * CHUNK_SIZE] = height;
            
            let potentialMax = height;
            if (height >= SEA_LEVEL + 2 && hash2D(wx, wz) > 0.98) {
                potentialMax = height + 25;
            }
            if (potentialMax > localMaxY) localMaxY = potentialMax;
        }
    }

    if (localMaxY >= MAX_HEIGHT) localMaxY = MAX_HEIGHT - 1;
    
    const allocatedHeight = localMaxY + 1;
    const data = new Uint8Array(CHUNK_SIZE * allocatedHeight * CHUNK_SIZE);
    
    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;
            const height = heights[x + z * CHUNK_SIZE];
            
            for (let y = 0; y < allocatedHeight; y++) {
                let block = 0;
                if (y === 0) {
                    block = 4; // Bedrock / Sand base
                } else if (y <= height) {
                    if (y === height) {
                        block = (height < SEA_LEVEL + 2) ? 4 : 1;
                    } else if (y > height - 4) {
                        block = (height < SEA_LEVEL + 2) ? 4 : 2;
                    } else {
                        block = 5;
                    }
                    
                    let cave = smoothNoise3D(wx * 0.04, y * 0.04, wz * 0.04);
                    if (Math.abs(cave - 0.5) < 0.08 && y < height - 5 && y > 3) {
                        block = 0; 
                    }
                } else if (y <= SEA_LEVEL) {
                    block = 17; // Full Water Block (Level 8)
                }
                
                
                if (block !== 0) {
                    data[getIndex(x, y, z)] = block;
                }
            }
            
            if (height >= SEA_LEVEL + 2 && hash2D(wx, wz) > 0.98) {
                const trunkHeight = Math.floor(12 + hash2D(wx * 1.5, wz * 1.5) * 8);
                for (let ty = 1; ty <= trunkHeight; ty++) {
                    if (height + ty < allocatedHeight) {
                        data[getIndex(x, height + ty, z)] = 3; 
                    }
                }
                const canopyCenterY = height + trunkHeight;
                const radius = 4;
                for (let lx = -radius; lx <= radius; lx++) {
                    for (let lz = -radius; lz <= radius; lz++) {
                        for (let ly = -radius; ly <= radius + 1; ly++) {
                            const distSq = (lx * lx) + (ly * ly * 0.8) + (lz * lz);
                            if (distSq <= (radius * radius) + 0.5) {
                                let tx = x + lx;
                                let tz = z + lz;
                                let ty = canopyCenterY + ly;
                                if (tx >= 0 && tx < CHUNK_SIZE && tz >= 0 && tz < CHUNK_SIZE && ty > 0 && ty < allocatedHeight) {
                                    let idx = getIndex(tx, ty, tz);
                                    if (data[idx] === 0) data[idx] = 6; 
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    self.postMessage({ cx, cz, allocatedHeight, data: data.buffer }, [data.buffer]);
}

self.onmessage = function (e) {
    const { cx, cz } = e.data;
    generateChunkData(cx, cz);
};
