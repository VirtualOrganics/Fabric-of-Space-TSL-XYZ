import * as THREE from 'three';

/**
 * AnalysisCompute - WebGPU Compute Pipeline for Voronoi Analysis
 * 
 * This replaces the CPU-based VoronoiAnalyzer with a WebGPU compute shader.
 * The compute shader performs all analysis operations in parallel on the GPU:
 * 1. Voxel summation for centroid calculation using atomic operations
 * 2. 2x2x2 junction detection for acute angle counting
 * 3. Atomic counters for thread-safe accumulation
 * 
 * Input: JFA output texture + seed buffer
 * Output: Updated seed buffer with centroids and acute counts
 */
export class AnalysisCompute {
    constructor(renderer) {
        this.renderer = renderer;
        this.device = null;
        this.computePipeline = null;
        this.bindGroups = [];
        
        // Analysis parameters
        this.volumeSize = 64;
        this.maxSeeds = 100;
        
        // Storage buffers
        this.seedBuffer = null;
        this.centroidDataBuffer = null;
        this.acuteCountBuffer = null;
        this.analysisResultsBuffer = null;
        
        // Bind group layout
        this.bindGroupLayout = null;
        
        console.log('🔍 AnalysisCompute constructor completed');
    }
    
    /**
     * Initialize the WebGPU compute pipeline
     */
    async init() {
        console.log('🔍 Initializing AnalysisCompute...');
        
        // Get WebGPU device for TSL
        this.device = this.renderer.getDevice();
        if (!this.device) {
            throw new Error('WebGPU device not available for TSL');
        }
        
        // Create compute shader module with error handling
        try {
            const shaderCode = this.getAnalysisComputeShader();
            console.log('🔍 Compiling analysis compute shader...');
            
            const computeShaderModule = this.device.createShaderModule({
                label: 'Voronoi Analysis Compute Shader',
                code: shaderCode
            });
            
            // Wait for compilation to complete and check for errors
            const compilationInfo = await computeShaderModule.getCompilationInfo();
            if (compilationInfo.messages.length > 0) {
                console.group('🔍 WGSL Compilation Messages:');
                for (const message of compilationInfo.messages) {
                    const level = message.type === 'error' ? 'error' : 'warn';
                    console[level](`${message.type}: ${message.message}`);
                    if (message.lineNum) {
                        console[level](`  Line ${message.lineNum}: ${message.linePos}`);
                    }
                }
                console.groupEnd();
                
                // Fail if there are compilation errors
                const hasErrors = compilationInfo.messages.some(msg => msg.type === 'error');
                if (hasErrors) {
                    throw new Error('WGSL shader compilation failed with errors');
                }
            }
            
            console.log('✅ Analysis compute shader compiled successfully');
            
            // Create bind group layout
            this.bindGroupLayout = this.device.createBindGroupLayout({
                label: 'Analysis Compute Bind Group Layout',
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        storageTexture: {
                            access: 'read-only',
                            format: 'r32uint',
                            viewDimension: '3d'
                        }
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        buffer: {
                            type: 'storage'
                        }
                    },
                    {
                        binding: 2,
                        visibility: GPUShaderStage.COMPUTE,
                        buffer: {
                            type: 'storage'
                        }
                    },
                    {
                        binding: 3,
                        visibility: GPUShaderStage.COMPUTE,
                        buffer: {
                            type: 'storage'
                        }
                    },
                    {
                        binding: 4,
                        visibility: GPUShaderStage.COMPUTE,
                        buffer: {
                            type: 'uniform'
                        }
                    }
                ]
            });
           
            // Create compute pipeline
            this.computePipeline = this.device.createComputePipeline({
                label: 'Analysis Compute Pipeline',
                layout: this.device.createPipelineLayout({
                    bindGroupLayouts: [this.bindGroupLayout]
                }),
                compute: {
                    module: computeShaderModule,
                    entryPoint: 'main'
                }
            });
            
            console.log('✅ AnalysisCompute initialized successfully');
            
        } catch (error) {
            console.error('❌ AnalysisCompute initialization failed:', error);
            throw error;
        }
    }
    
    /**
     * Create storage buffers for analysis data
     */
    createBuffers(numSeeds) {
        console.log(`🔍 Creating analysis buffers for ${numSeeds} seeds...`);
        
        // Seed buffer: position(3) + centroid(3) + acuteCount(1) + voxelCount(1) = 8 floats per seed
        const seedBufferSize = numSeeds * 8 * 4; // 8 floats * 4 bytes per float
        this.seedBuffer = this.device.createBuffer({
            label: 'Seed Buffer',
            size: seedBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });
        
        // Centroid data buffer: positionSumX(1) + positionSumY(1) + positionSumZ(1) + voxelCount(1) = 4 uint32 per seed
        const centroidBufferSize = numSeeds * 4 * 4; // 4 uint32 * 4 bytes per uint32
        this.centroidDataBuffer = this.device.createBuffer({
            label: 'Centroid Data Buffer',
            size: centroidBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        
        // Acute count buffer: one atomic counter per seed
        const acuteBufferSize = numSeeds * 4; // 1 uint32 per seed
        this.acuteCountBuffer = this.device.createBuffer({
            label: 'Acute Count Buffer',
            size: acuteBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        
        // Analysis results buffer for debugging
        this.analysisResultsBuffer = this.device.createBuffer({
            label: 'Analysis Results Buffer',
            size: 64, // Space for general analysis data
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        
        console.log('✅ Analysis buffers created successfully');
    }
    
    /**
     * Update seed buffer with current seed data
     */
    updateSeedBuffer(seedData) {
        const seedArray = new Float32Array(seedData.length * 8);
        
        for (let i = 0; i < seedData.length; i++) {
            const seed = seedData[i];
            const offset = i * 8;
            
            // Position (3 floats)
            seedArray[offset + 0] = seed.position.x;
            seedArray[offset + 1] = seed.position.y;
            seedArray[offset + 2] = seed.position.z;
            
            // Centroid (3 floats) - initialized to position
            seedArray[offset + 3] = seed.position.x;
            seedArray[offset + 4] = seed.position.y;
            seedArray[offset + 5] = seed.position.z;
            
            // Acute count (1 float)
            seedArray[offset + 6] = 0.0;
            
            // Voxel count (1 float)
            seedArray[offset + 7] = 0.0;
        }
        
        this.device.queue.writeBuffer(this.seedBuffer, 0, seedArray);
    }
    
    /**
     * Clear analysis buffers before computation
     */
    clearBuffers(numSeeds) {
        // Clear centroid data buffer (uint32 for atomic operations)
        const centroidData = new Uint32Array(numSeeds * 4);
        this.device.queue.writeBuffer(this.centroidDataBuffer, 0, centroidData);
        
        // Clear acute count buffer
        const acuteData = new Uint32Array(numSeeds);
        this.device.queue.writeBuffer(this.acuteCountBuffer, 0, acuteData);
    }
    
    /**
     * Run the analysis compute pass
     */
    async compute(jfaTexture, seedData) {
        console.log('🔍 Running analysis compute pass for TSL...');
        
        const numSeeds = seedData.length;
        
        // Create buffers if needed
        if (!this.seedBuffer || this.maxSeeds < numSeeds) {
            this.maxSeeds = Math.max(numSeeds, this.maxSeeds);
            this.createBuffers(this.maxSeeds);
        }
        
        // Update seed buffer with current data
        this.updateSeedBuffer(seedData);
        
        // Clear analysis buffers
        this.clearBuffers(numSeeds);
        
        // Create uniform buffer for parameters
        const uniformData = new Uint32Array([
            this.volumeSize,  // volumeSize
            numSeeds          // numSeeds
        ]);
        
        const uniformBuffer = this.device.createBuffer({
            label: 'Analysis Uniform Buffer',
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        
        // Create bind group
        const bindGroup = this.device.createBindGroup({
            label: 'Analysis Compute Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: jfaTexture.createView()
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.seedBuffer
                    }
                },
                {
                    binding: 2,
                    resource: {
                        buffer: this.centroidDataBuffer
                    }
                },
                {
                    binding: 3,
                    resource: {
                        buffer: this.acuteCountBuffer
                    }
                },
                {
                    binding: 4,
                    resource: {
                        buffer: uniformBuffer
                    }
                }
            ]
        });
        
        // Run compute pass
        const commandEncoder = this.device.createCommandEncoder({
            label: 'Analysis Compute Command Encoder'
        });
        
        const computePass = commandEncoder.beginComputePass({
            label: 'Analysis Compute Pass'
        });
        
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, bindGroup);
        
        // Dispatch with workgroup size that covers the entire volume
        const workgroupSize = 8;
        const dispatchSize = Math.ceil(this.volumeSize / workgroupSize);
        computePass.dispatchWorkgroups(dispatchSize, dispatchSize, dispatchSize);
        
        computePass.end();
        
        // Submit the command buffer
        this.device.queue.submit([commandEncoder.finish()]);
        
        // Wait for completion
        await this.device.queue.onSubmittedWorkDone();
        
        // Finalize centroids by converting atomic results back to world coordinates
        await this.finalizeCentroids(numSeeds);
        
        console.log('✅ Analysis compute pass completed');
    }
    
    /**
     * Finalize centroids by converting atomic results to world coordinates
     */
    async finalizeCentroids(numSeeds) {
        console.log('🔍 Finalizing centroids...');
        
        // Read atomic centroid data
        const stagingBuffer = this.device.createBuffer({
            label: 'Centroid Staging Buffer',
            size: numSeeds * 4 * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(
            this.centroidDataBuffer, 0,
            stagingBuffer, 0,
            numSeeds * 4 * 4
        );
        this.device.queue.submit([commandEncoder.finish()]);
        
        await this.device.queue.onSubmittedWorkDone();
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const atomicData = new Uint32Array(stagingBuffer.getMappedRange());
        
        // Convert atomic results back to centroids and update seed buffer
        const seedArray = new Float32Array(numSeeds * 8);
        
        for (let i = 0; i < numSeeds; i++) {
            const atomicOffset = i * 4;
            const seedOffset = i * 8;
            
            // Read atomic values
            const sumX = atomicData[atomicOffset + 0];
            const sumY = atomicData[atomicOffset + 1];
            const sumZ = atomicData[atomicOffset + 2];
            const voxelCount = atomicData[atomicOffset + 3];
            
            // Convert back to world coordinates
            if (voxelCount > 0) {
                const centroidX = (sumX / 1000000.0) / voxelCount - 1.0;
                const centroidY = (sumY / 1000000.0) / voxelCount - 1.0;
                const centroidZ = (sumZ / 1000000.0) / voxelCount - 1.0;
                
                // Update seed buffer with calculated centroids
                seedArray[seedOffset + 3] = centroidX;
                seedArray[seedOffset + 4] = centroidY;
                seedArray[seedOffset + 5] = centroidZ;
                seedArray[seedOffset + 7] = voxelCount; // Store voxel count
            }
        }
        
        // Write updated centroids back to seed buffer
        this.device.queue.writeBuffer(this.seedBuffer, 0, seedArray);
        
        stagingBuffer.unmap();
        console.log('✅ Centroids finalized');
    }
    
    /**
     * Get analysis results from GPU buffers
     */
    async getResults() {
        console.log('🔍 Reading analysis results from GPU...');
        
        try {
            // Create staging buffers for readback
            const seedStagingBuffer = this.device.createBuffer({
                label: 'Seed Staging Buffer',
                size: this.seedBuffer.size,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
            });
            
            const acuteStagingBuffer = this.device.createBuffer({
                label: 'Acute Count Staging Buffer',
                size: this.acuteCountBuffer.size,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
            });
            
            const centroidStagingBuffer = this.device.createBuffer({
                label: 'Centroid Staging Buffer',
                size: this.centroidDataBuffer.size,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
            });
            
            // Copy data from GPU buffers to staging buffers
            const commandEncoder = this.device.createCommandEncoder({
                label: 'Analysis Results Copy Command Encoder'
            });
            
            commandEncoder.copyBufferToBuffer(
                this.seedBuffer, 0,
                seedStagingBuffer, 0,
                this.seedBuffer.size
            );
            
            commandEncoder.copyBufferToBuffer(
                this.acuteCountBuffer, 0,
                acuteStagingBuffer, 0,
                this.acuteCountBuffer.size
            );
            
            commandEncoder.copyBufferToBuffer(
                this.centroidDataBuffer, 0,
                centroidStagingBuffer, 0,
                this.centroidDataBuffer.size
            );
            
            this.device.queue.submit([commandEncoder.finish()]);
            
            // Wait for completion
            await this.device.queue.onSubmittedWorkDone();
            
            // Map and read the data
            await seedStagingBuffer.mapAsync(GPUMapMode.READ);
            await acuteStagingBuffer.mapAsync(GPUMapMode.READ);
            await centroidStagingBuffer.mapAsync(GPUMapMode.READ);
            
            const seedData = new Float32Array(seedStagingBuffer.getMappedRange());
            const acuteData = new Uint32Array(acuteStagingBuffer.getMappedRange());
            const centroidData = new Uint32Array(centroidStagingBuffer.getMappedRange());
            
            // Analyze results for debugging
            let totalAcuteCount = 0;
            let nonZeroSeeds = 0;
            let maxAcuteCount = 0;
            
            for (let i = 0; i < acuteData.length; i++) {
                const count = acuteData[i];
                totalAcuteCount += count;
                if (count > 0) {
                    nonZeroSeeds++;
                    maxAcuteCount = Math.max(maxAcuteCount, count);
                }
            }
            
            console.log('🔍 Analysis Results Summary:');
            console.log(`  Total acute count: ${totalAcuteCount}`);
            console.log(`  Seeds with non-zero acute count: ${nonZeroSeeds}/${acuteData.length}`);
            console.log(`  Max acute count: ${maxAcuteCount}`);
            
            // Check centroid data
            let nonZeroCentroids = 0;
            for (let i = 0; i < centroidData.length; i += 4) {
                const voxelCount = centroidData[i + 3];
                if (voxelCount > 0) {
                    nonZeroCentroids++;
                }
            }
            console.log(`  Seeds with valid centroids: ${nonZeroCentroids}/${centroidData.length / 4}`);
            
            // If we have zero results, warn about potential shader issues
            if (totalAcuteCount === 0) {
                console.warn('⚠️  Analysis produced zero acute counts - shader may not be executing properly!');
            } else {
                console.log('✅ Analysis shader is producing non-zero results');
            }
            
            // Unmap buffers
            seedStagingBuffer.unmap();
            acuteStagingBuffer.unmap();
            centroidStagingBuffer.unmap();
            
            // Clean up staging buffers
            seedStagingBuffer.destroy();
            acuteStagingBuffer.destroy();
            centroidStagingBuffer.destroy();
            
            return {
                seedData,
                acuteData,
                centroidData,
                totalAcuteCount,
                nonZeroSeeds,
                maxAcuteCount
            };
            
        } catch (error) {
            console.error('❌ Failed to read analysis results:', error);
            throw error;
        }
    }

    /**
     * Get the analysis buffers for use by other compute passes
     * @returns {Object} Object containing GPU buffers
     */
    getBuffers() {
        return {
            seedBuffer: this.seedBuffer,
            acuteCountBuffer: this.acuteCountBuffer,
            resultsBuffer: this.analysisResultsBuffer
        };
    }
    
    /**
     * Get the WGSL compute shader code for analysis
     */
    getAnalysisComputeShader() {
        return `
// 1) Uniform parameters
struct AnalysisUniforms {
  volumeSize : u32;
  numSeeds   : u32;
};

// 2) Seed data layout (must match JS seedBuffer layout)
struct SeedData {
  position   : vec3<f32>;
  centroid   : vec3<f32>;
  acuteCount : f32;
  voxelCount : f32;
};

// 3) Centroid accumulation with atomics
struct CentroidData {
  positionSumX : atomic<u32>;
  positionSumY : atomic<u32>;
  positionSumZ : atomic<u32>;
  voxelCount   : atomic<u32>;
};

// 4) Bindings
@group(0) @binding(0)
var jfaTexture : texture_storage_3d<r32uint, read>;

@group(0) @binding(1)
var<storage, read_write> seedBuffer       : array<SeedData>;

@group(0) @binding(2)
var<storage, read_write> centroidData     : array<CentroidData>;

@group(0) @binding(3)
var<storage, read_write> acuteCountBuffer : array<atomic<u32>>;

@group(0) @binding(4)
var<uniform> uniforms                     : AnalysisUniforms;

// Get cell ID from texture coordinates
fn getCellID(coords: vec3<i32>) -> i32 {
    // Bounds checking
    if (coords.x < 0 || coords.x >= i32(uniforms.volumeSize) ||
        coords.y < 0 || coords.y >= i32(uniforms.volumeSize) ||
        coords.z < 0 || coords.z >= i32(uniforms.volumeSize)) {
        return -1;
    }
    
    // Load the integer cell ID directly from the r32uint storage texture
    let cellId = i32(textureLoad(jfaTexture, coords, 0).r);
    
    // Check if valid seed ID (4294967295u is the invalid marker)
    if (cellId >= i32(uniforms.numSeeds) || cellId < 0) {
        return -1;
    }
    
    return cellId;
}

// Convert 3D coordinates to world space [-1, 1]
fn toWorldSpace(coords: vec3<i32>) -> vec3<f32> {
    let fcoords = vec3<f32>(coords);
    let size = f32(uniforms.volumeSize);
    return (fcoords / size) * 2.0 - 1.0;
}

// Main compute shader entry point
@compute @workgroup_size(8, 8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coords = vec3<i32>(global_id);
    let volumeSize = i32(uniforms.volumeSize);
    
    // Check bounds
    if (coords.x >= volumeSize || coords.y >= volumeSize || coords.z >= volumeSize) {
        return;
    }
    
    // Phase 1: Voxel summation for centroid calculation
    let cellID = getCellID(coords);
    if (cellID >= 0 && cellID < i32(uniforms.numSeeds)) {
        let worldPos = toWorldSpace(coords);
        
        // Atomic accumulation for centroid calculation
        // Convert float coordinates to fixed-point integers for atomic operations
        let fixedX = u32((worldPos.x + 1.0) * 1000000.0); // Scale and offset for precision
        let fixedY = u32((worldPos.y + 1.0) * 1000000.0);
        let fixedZ = u32((worldPos.z + 1.0) * 1000000.0);
        
        atomicAdd(&centroidData[cellID].positionSumX, fixedX);
        atomicAdd(&centroidData[cellID].positionSumY, fixedY);
        atomicAdd(&centroidData[cellID].positionSumZ, fixedZ);
        atomicAdd(&centroidData[cellID].voxelCount, 1u);
    }
    
    // Phase 2: Junction detection for acute angles
    // Only process if we're not at the edge (need 2x2x2 cube)
    if (coords.x < volumeSize - 1 && coords.y < volumeSize - 1 && coords.z < volumeSize - 1) {
        // Get the 8 cell IDs in the 2x2x2 cube
        var cellIDs: array<i32, 8>;
        cellIDs[0] = getCellID(coords + vec3<i32>(0, 0, 0));
        cellIDs[1] = getCellID(coords + vec3<i32>(1, 0, 0));
        cellIDs[2] = getCellID(coords + vec3<i32>(0, 1, 0));
        cellIDs[3] = getCellID(coords + vec3<i32>(1, 1, 0));
        cellIDs[4] = getCellID(coords + vec3<i32>(0, 0, 1));
        cellIDs[5] = getCellID(coords + vec3<i32>(1, 0, 1));
        cellIDs[6] = getCellID(coords + vec3<i32>(0, 1, 1));
        cellIDs[7] = getCellID(coords + vec3<i32>(1, 1, 1));
        
        // Count unique cell IDs
        var uniqueIDs: array<i32, 8>;
        var uniqueCount = 0;
        
        for (var i = 0; i < 8; i++) {
            let id = cellIDs[i];
            if (id >= 0) {
                var isUnique = true;
                for (var j = 0; j < uniqueCount; j++) {
                    if (uniqueIDs[j] == id) {
                        isUnique = false;
                        break;
                    }
                }
                if (isUnique) {
                    uniqueIDs[uniqueCount] = id;
                    uniqueCount++;
                }
            }
        }
        
        // If we have 3+ unique cells, it's a junction
        if (uniqueCount >= 3) {
            let junctionPos = toWorldSpace(coords) + vec3<f32>(0.5) / f32(uniforms.volumeSize) * 2.0;
            
            // Calculate angles between all pairs of seeds meeting at this junction
            for (var i = 0; i < uniqueCount; i++) {
                for (var j = i + 1; j < uniqueCount; j++) {
                    let idA = uniqueIDs[i];
                    let idB = uniqueIDs[j];
                    
                    if (idA < i32(uniforms.numSeeds) && idB < i32(uniforms.numSeeds)) {
                        let seedA = seedBuffer[idA];
                        let seedB = seedBuffer[idB];
                        
                        // Calculate vectors from junction to each seed
                        let vA = normalize(seedA.position - junctionPos);
                        let vB = normalize(seedB.position - junctionPos);
                        
                        // Calculate angle between vectors
                        let dotProduct = dot(vA, vB);
                        let angle = acos(clamp(dotProduct, -1.0, 1.0));
                        
                        // Count acute angles (< 90 degrees)
                        if (angle < 1.5707963) { // PI/2
                            atomicAdd(&acuteCountBuffer[idA], 1u);
                            atomicAdd(&acuteCountBuffer[idB], 1u);
                        }
                    }
                }
            }
        }
    }
}
        `;
    }
    
    /**
     * Cleanup resources
     */
    destroy() {
        if (this.seedBuffer) {
            this.seedBuffer.destroy();
        }
        if (this.centroidDataBuffer) {
            this.centroidDataBuffer.destroy();
        }
        if (this.acuteCountBuffer) {
            this.acuteCountBuffer.destroy();
        }
        if (this.analysisResultsBuffer) {
            this.analysisResultsBuffer.destroy();
        }
        
        console.log('🔍 AnalysisCompute resources destroyed');
    }
} 