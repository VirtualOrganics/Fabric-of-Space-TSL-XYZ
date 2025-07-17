import * as THREE from 'three';

/**
 * PhysicsCompute - WebGPU Compute Pipeline for Physics Calculations
 * 
 * This replaces the CPU-based PhysicsEngine with a WebGPU compute shader.
 * The compute shader performs all physics operations in parallel on the GPU:
 * 1. Reads centroid and acute count data from analysis results
 * 2. Calculates growth/shrink flux based on threshold and mode
 * 3. Applies centroid-based movement with momentum and damping
 * 4. Updates seed positions with boundary clamping
 * 
 * Input: Analysis results (centroids, acute counts) + physics settings
 * Output: Updated seed positions
 */
export class PhysicsCompute {
    constructor(renderer) {
        this.renderer = renderer;
        this.device = null;
        this.computePipeline = null;
        
        // Physics parameters
        this.maxSeeds = 100;
        
        // Storage buffers
        this.seedBuffer = null;
        this.physicsStateBuffer = null;
        this.statisticsBuffer = null;
        
        // Bind group layout
        this.bindGroupLayout = null;
        
        // Previous deltas for momentum (stored on GPU)
        this.previousDeltasBuffer = null;
        
        console.log('⚡ PhysicsCompute constructor completed');
    }
    
    /**
     * Initialize the WebGPU compute pipeline
     */
    async init() {
        console.log('⚡ Initializing PhysicsCompute...');
        
        // Get WebGPU device
        this.device = this.renderer.getDevice();
        if (!this.device) {
            throw new Error('WebGPU device not available');
        }
        
        // Create compute shader module
        const computeShaderModule = this.device.createShaderModule({
            label: 'Physics Compute Shader',
            code: this.getPhysicsComputeShader()
        });
        
        // Create bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Physics Compute Bind Group Layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'storage'
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
                        type: 'uniform'
                    }
                }
            ]
        });
        
        // Create compute pipeline
        this.computePipeline = this.device.createComputePipeline({
            label: 'Physics Compute Pipeline',
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout]
            }),
            compute: {
                module: computeShaderModule,
                entryPoint: 'main'
            }
        });
        
        console.log('✅ PhysicsCompute initialized successfully');
    }
    
    /**
     * Create storage buffers for physics data
     */
    createBuffers(numSeeds) {
        console.log(`⚡ Creating physics buffers for ${numSeeds} seeds...`);
        
        // Seed buffer: position(3) + centroid(3) + acuteCount(1) + voxelCount(1) = 8 floats per seed
        const seedBufferSize = numSeeds * 8 * 4;
        this.seedBuffer = this.device.createBuffer({
            label: 'Physics Seed Buffer',
            size: seedBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });
        
        // Previous deltas buffer for momentum: 1 float per seed
        const deltaBufferSize = numSeeds * 4;
        this.previousDeltasBuffer = this.device.createBuffer({
            label: 'Previous Deltas Buffer',
            size: deltaBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        
        // Physics statistics buffer
        this.statisticsBuffer = this.device.createBuffer({
            label: 'Physics Statistics Buffer',
            size: 32, // 8 floats for various statistics
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });
        
        // Initialize previous deltas to zero
        const zeroDeltas = new Float32Array(numSeeds);
        this.device.queue.writeBuffer(this.previousDeltasBuffer, 0, zeroDeltas);
        
        console.log('✅ Physics buffers created successfully');
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
            
            // Centroid (3 floats)
            seedArray[offset + 3] = seed.centroid ? seed.centroid.x : seed.position.x;
            seedArray[offset + 4] = seed.centroid ? seed.centroid.y : seed.position.y;
            seedArray[offset + 5] = seed.centroid ? seed.centroid.z : seed.position.z;
            
            // Acute count (1 float)
            seedArray[offset + 6] = seed.acuteCount || 0;
            
            // Voxel count (1 float)
            seedArray[offset + 7] = seed.voxelCount || 0;
        }
        
        this.device.queue.writeBuffer(this.seedBuffer, 0, seedArray);
    }
    
    /**
     * Clear physics statistics
     */
    clearStatistics() {
        const statsData = new Float32Array(8); // All zeros
        this.device.queue.writeBuffer(this.statisticsBuffer, 0, statsData);
    }
    
    /**
     * Run the physics compute pass using GPU buffers directly
     * @param {Object} analysisBuffers - GPU buffers from AnalysisCompute
     * @param {Object} settings - Physics settings
     * @param {number} deltaTime - Time delta
     * @param {number} numSeeds - Number of seeds
     */
    async compute(analysisBuffers, settings, deltaTime, numSeeds) {
        console.log('⚡ Running physics compute pass (GPU-only)...');
        
        // Use the analysis buffers directly - no CPU data transfer!
        this.seedBuffer = analysisBuffers.seedBuffer;
        this.acuteCountBuffer = analysisBuffers.acuteCountBuffer;
        
        // Clear statistics
        this.clearStatistics();
        
        // Create uniform buffer for physics parameters
        const uniformData = new Float32Array([
            settings.threshold,      // threshold
            settings.growthRate,     // growthRate
            deltaTime,              // deltaTime
            numSeeds,               // numSeeds (as float for easier shader access)
            settings.mode === 'balanced' ? 0.0 : 
            settings.mode === 'growthOnly' ? 1.0 : 
            settings.mode === 'shrinkOnly' ? 2.0 : 3.0, // mode (0=balanced, 1=growthOnly, 2=shrinkOnly, 3=inverse)
            0.01,                   // k (base growth rate multiplier)
            0.7,                    // damping
            0.1,                    // maxDelta
            1.5,                    // growthPower
            0.0,                    // padding
            0.0,                    // padding
            0.0                     // padding
        ]);
        
        const uniformBuffer = this.device.createBuffer({
            label: 'Physics Uniform Buffer',
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        
        // Create bind group
        const bindGroup = this.device.createBindGroup({
            label: 'Physics Compute Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.seedBuffer
                    }
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.previousDeltasBuffer
                    }
                },
                {
                    binding: 2,
                    resource: {
                        buffer: this.statisticsBuffer
                    }
                },
                {
                    binding: 3,
                    resource: {
                        buffer: uniformBuffer
                    }
                }
            ]
        });
        
        // Run compute pass
        const commandEncoder = this.device.createCommandEncoder({
            label: 'Physics Compute Command Encoder'
        });
        
        const computePass = commandEncoder.beginComputePass({
            label: 'Physics Compute Pass'
        });
        
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, bindGroup);
        
        // Dispatch one thread per seed
        const workgroupSize = 64;
        const numWorkgroups = Math.ceil(numSeeds / workgroupSize);
        computePass.dispatchWorkgroups(numWorkgroups, 1, 1);
        
        computePass.end();
        
        // Submit the command buffer
        this.device.queue.submit([commandEncoder.finish()]);
        
        // Wait for completion
        await this.device.queue.onSubmittedWorkDone();
        
        console.log('✅ Physics compute pass completed');
    }
    
    /**
     * DEPRECATED: We no longer read results back to CPU
     * The physics results stay on GPU and are consumed directly by the renderer
     * This eliminates the second GPU->CPU bottleneck
     */
    // async getResults(seedData) {
    //     // NO LONGER NEEDED - Data stays on GPU!
    // }
    
    /**
     * Get the seed buffer for use by the renderer
     * @returns {GPUBuffer} The updated seed buffer
     */
    getSeedBuffer() {
        return this.seedBuffer;
    }
    
    /**
     * Get physics statistics
     */
    async getStatistics() {
        // Create staging buffer for statistics
        const stagingBuffer = this.device.createBuffer({
            label: 'Statistics Staging Buffer',
            size: 32,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        
        // Copy statistics to staging buffer
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(
            this.statisticsBuffer, 0,
            stagingBuffer, 0,
            32
        );
        this.device.queue.submit([commandEncoder.finish()]);
        
        await this.device.queue.onSubmittedWorkDone();
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const statsData = new Float32Array(stagingBuffer.getMappedRange());
        
        const statistics = {
            totalDisplacement: statsData[0],
            maxDisplacement: statsData[1],
            activePoints: Math.round(statsData[2]),
            growingPoints: Math.round(statsData[3]),
            shrinkingPoints: Math.round(statsData[4]),
            growingCells: Math.round(statsData[3]), // Alias for compatibility
            shrinkingCells: Math.round(statsData[4]) // Alias for compatibility
        };
        
        stagingBuffer.unmap();
        return statistics;
    }
    
    /**
     * Reset physics state
     */
    reset() {
        if (this.previousDeltasBuffer) {
            const zeroDeltas = new Float32Array(this.maxSeeds);
            this.device.queue.writeBuffer(this.previousDeltasBuffer, 0, zeroDeltas);
        }
        
        if (this.statisticsBuffer) {
            const zeroStats = new Float32Array(8);
            this.device.queue.writeBuffer(this.statisticsBuffer, 0, zeroStats);
        }
    }
    
    /**
     * Get the WGSL compute shader code for physics
     */
    getPhysicsComputeShader() {
        return `
            // Physics uniform buffer
            struct PhysicsUniforms {
                threshold: f32,
                growthRate: f32,
                deltaTime: f32,
                numSeeds: f32,
                mode: f32,
                k: f32,
                damping: f32,
                maxDelta: f32,
                growthPower: f32,
                padding1: f32,
                padding2: f32,
                padding3: f32
            }
            
            // Seed data structure
            struct SeedData {
                position: vec3<f32>,
                centroid: vec3<f32>,
                acuteCount: f32,
                voxelCount: f32
            }
            
            @group(0) @binding(0) var<storage, read_write> seedBuffer: array<SeedData>;
            @group(0) @binding(1) var<storage, read_write> previousDeltas: array<f32>;
            @group(0) @binding(2) var<storage, read_write> statistics: array<f32>;
            @group(0) @binding(3) var<uniform> uniforms: PhysicsUniforms;
            
            // Simple hash function for deterministic randomness
            fn hash(x: u32) -> f32 {
                let h = (x * 2654435761u) % 2147483647u;
                return f32(h) / 2147483647.0;
            }
            
            // Calculate deterministic centroid offset (fallback if no real centroid)
            fn calculateFallbackCentroid(seedIndex: u32, position: vec3<f32>) -> vec3<f32> {
                let h = seedIndex * 2654435761u;
                let offsetX = (hash(h) - 0.5) * 0.1;
                let offsetY = (hash(h + 1000u) - 0.5) * 0.1;
                let offsetZ = (hash(h + 2000u) - 0.5) * 0.1;
                
                return position + vec3<f32>(offsetX, offsetY, offsetZ);
            }
            
            @compute @workgroup_size(64)
            fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                let index = global_id.x;
                let numSeeds = u32(uniforms.numSeeds);
                
                // Check bounds
                if (index >= numSeeds) {
                    return;
                }
                
                let seed = seedBuffer[index];
                let score = seed.acuteCount;
                let threshold = uniforms.threshold;
                let mode = uniforms.mode;
                
                // Calculate flux based on mode and threshold
                var shouldGrow = false;
                var fluxMagnitude = 0.0;
                
                if (mode == 0.0) { // balanced
                    if (score > threshold) {
                        shouldGrow = true;
                        fluxMagnitude = score - threshold;
                    } else if (score < threshold) {
                        shouldGrow = false;
                        fluxMagnitude = threshold - score;
                    }
                } else if (mode == 1.0) { // growthOnly
                    if (score > threshold) {
                        shouldGrow = true;
                        fluxMagnitude = score - threshold;
                    }
                } else if (mode == 2.0) { // shrinkOnly
                    if (score > threshold) {
                        shouldGrow = false;
                        fluxMagnitude = score - threshold;
                    }
                } else if (mode == 3.0) { // inverse
                    if (score > threshold) {
                        shouldGrow = false;
                        fluxMagnitude = score - threshold;
                    } else if (score < threshold) {
                        shouldGrow = true;
                        fluxMagnitude = threshold - score;
                    }
                }
                
                // Apply non-linear growth function
                var rawFlux = 0.0;
                if (fluxMagnitude > 0.0) {
                    rawFlux = pow(fluxMagnitude, uniforms.growthPower);
                    if (!shouldGrow) {
                        rawFlux = -rawFlux;
                    }
                }
                
                // If no flux, skip
                if (rawFlux == 0.0) {
                    return;
                }
                
                // Use real centroid if available, otherwise calculate fallback
                var centroid = seed.centroid;
                let centroidDistance = distance(seed.position, centroid);
                if (centroidDistance < 1e-6) {
                    centroid = calculateFallbackCentroid(index, seed.position);
                }
                
                // Calculate growth direction
                var direction = seed.position - centroid;
                let length = length(direction);
                
                // Normalize direction
                if (length < 1e-6) {
                    // Point is at centroid, use small random direction
                    direction = vec3<f32>(
                        (hash(index) - 0.5) * 0.01,
                        (hash(index + 1000u) - 0.5) * 0.01,
                        (hash(index + 2000u) - 0.5) * 0.01
                    );
                } else {
                    direction = direction / length;
                }
                
                // Calculate displacement magnitude
                var delta = uniforms.k * rawFlux * uniforms.growthRate;
                
                // Apply damping with previous delta
                let prevDelta = previousDeltas[index];
                delta = uniforms.damping * prevDelta + (1.0 - uniforms.damping) * delta;
                
                // Clamp to maximum delta
                delta = clamp(delta, -uniforms.maxDelta, uniforms.maxDelta);
                
                // Store for next iteration
                previousDeltas[index] = delta;
                
                // Calculate new position
                var newPosition = seed.position + direction * delta;
                
                // Keep seeds within bounds [-0.9, 0.9]
                newPosition = clamp(newPosition, vec3<f32>(-0.9), vec3<f32>(0.9));
                
                // Update seed position
                seedBuffer[index].position = newPosition;
                
                // Update statistics (atomic operations for thread safety)
                if (abs(delta) > 0.0) {
                    atomicAdd(&statistics[0], abs(delta)); // totalDisplacement
                    // Note: maxDisplacement requires special handling, simplified here
                    statistics[1] = max(statistics[1], abs(delta)); // maxDisplacement (not thread-safe but acceptable)
                    atomicAdd(&statistics[2], 1.0); // activePoints
                    
                    if (rawFlux > 0.0) {
                        atomicAdd(&statistics[3], 1.0); // growingPoints
                    } else if (rawFlux < 0.0) {
                        atomicAdd(&statistics[4], 1.0); // shrinkingPoints
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
        if (this.previousDeltasBuffer) {
            this.previousDeltasBuffer.destroy();
        }
        if (this.statisticsBuffer) {
            this.statisticsBuffer.destroy();
        }
        
        console.log('⚡ PhysicsCompute resources destroyed');
    }
} 