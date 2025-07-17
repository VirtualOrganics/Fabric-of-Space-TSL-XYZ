import * as THREE from 'three';

/**
 * JFACompute - WebGPU Compute Pipeline for Jump Flooding Algorithm
 * 
 * This replaces the GPUComputationRenderer hack with a true WebGPU compute pass.
 * The JFA algorithm generates 3D Voronoi diagrams using iterative flood-fill on GPU.
 * 
 * Input: StorageBuffer containing seedData
 * Output: StorageTexture (the label atlas)
 * Shader: WGSL compute shader (translated from GLSL)
 */
export class JFACompute {
    constructor(renderer) {
        this.renderer = renderer;
        this.device = null;
        this.computePipeline = null;
        this.bindGroups = [];
        
        // JFA parameters
        this.volumeSize = 64;
        this.atlasSize = 0;
        this.slicesPerRow = 0;
        
        // Storage resources
        this.seedBuffer = null;
        this.outputTexture = null;
        this.uniformBuffer = null;
        
        // Performance tracking
        this.lastComputeTime = 0;
        
        console.log('🖥️ JFACompute constructor completed');
    }
    
    /**
     * Initialize the WebGPU compute pipeline
     */
    async init() {
        console.log('🚀 Initializing JFA WebGPU compute pipeline...');
        
        try {
            // Get WebGPU device from renderer
            this.device = this.renderer.getDevice();
            if (!this.device) {
                throw new Error('WebGPU device not available');
            }
            
            // Calculate atlas parameters
            this.updateVolumeParameters();
            
            // Create compute shader
            await this.createComputeShader();
            
            // Create storage resources
            this.createStorageResources();
            
            // Create compute pipeline
            this.createComputePipeline();
            
            console.log('✅ JFA WebGPU compute pipeline initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize JFA compute pipeline:', error);
            throw error;
        }
    }
    
    /**
     * Update volume parameters based on current settings
     */
    updateVolumeParameters() {
        this.slicesPerRow = Math.ceil(Math.sqrt(this.volumeSize));
        this.atlasSize = this.volumeSize * this.slicesPerRow;
        
        console.log(`📐 JFA volume parameters: ${this.volumeSize}³ → ${this.atlasSize}² atlas`);
    }
    
    /**
     * Set the volume resolution
     */
    setResolution(resolution) {
        this.volumeSize = resolution;
        this.updateVolumeParameters();
        
        // Recreate resources with new size
        this.cleanup();
        this.createStorageResources();
        this.createComputePipeline();
        
        console.log(`🔧 JFA resolution set to ${resolution}³`);
    }
    
    /**
     * Create the WGSL compute shader (translated from GLSL)
     */
    async createComputeShader() {
        // WGSL compute shader for JFA
        // This is translated from the original GLSL version
        this.computeShaderCode = /* wgsl */ `
            // Uniforms
            struct Uniforms {
                volumeSize: u32,
                atlasSize: u32,
                slicesPerRow: u32,
                stepSize: u32,
                numPoints: u32,
                padding: array<u32, 3>
            };
            
            // Seed data structure
            struct SeedData {
                position: vec3<f32>,
                weight: f32,
                cellId: u32,
                padding: array<u32, 3>
            };
            
            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read> seedData: array<SeedData>;
            @group(0) @binding(2) var outputTexture: texture_storage_2d<rgba32float, write>;
            @group(0) @binding(3) var inputTexture: texture_2d<f32>;
            
            // Convert 3D coordinates to 2D atlas coordinates
            fn coords3DTo2D(coords3D: vec3<u32>) -> vec2<u32> {
                let sliceIndex = coords3D.z;
                let sliceX = sliceIndex % uniforms.slicesPerRow;
                let sliceY = sliceIndex / uniforms.slicesPerRow;
                
                return vec2<u32>(
                    sliceX * uniforms.volumeSize + coords3D.x,
                    sliceY * uniforms.volumeSize + coords3D.y
                );
            }
            
            // Convert 2D atlas coordinates to 3D coordinates
            fn coords2DTo3D(coords2D: vec2<u32>) -> vec3<u32> {
                let sliceX = coords2D.x / uniforms.volumeSize;
                let sliceY = coords2D.y / uniforms.volumeSize;
                let sliceIndex = sliceY * uniforms.slicesPerRow + sliceX;
                
                return vec3<u32>(
                    coords2D.x % uniforms.volumeSize,
                    coords2D.y % uniforms.volumeSize,
                    sliceIndex
                );
            }
            
            // Distance calculation with weights
            fn calculateDistance(pos1: vec3<f32>, pos2: vec3<f32>, weight: f32) -> f32 {
                let diff = pos1 - pos2;
                let distance = sqrt(dot(diff, diff));
                return distance / weight; // Weighted distance
            }
            
            // JFA step function
            @compute @workgroup_size(8, 8, 1)
            fn jfaStep(@builtin(global_invocation_id) global_id: vec3<u32>) {
                let coords2D = global_id.xy;
                
                // Check bounds
                if (coords2D.x >= uniforms.atlasSize || coords2D.y >= uniforms.atlasSize) {
                    return;
                }
                
                // Convert to 3D coordinates
                let coords3D = coords2DTo3D(coords2D);
                if (coords3D.z >= uniforms.volumeSize) {
                    return;
                }
                
                // Current position in world space
                let currentPos = vec3<f32>(coords3D) / f32(uniforms.volumeSize - 1u);
                
                // Initialize best values
                var bestDistance = 999999.0;
                var bestSeedId = 0u;
                var bestSeedPos = vec3<f32>(0.0);
                
                // Sample current pixel
                let currentSample = textureLoad(inputTexture, coords2D, 0);
                if (currentSample.w > 0.0) {
                    bestDistance = currentSample.w;
                    bestSeedId = u32(currentSample.z);
                    bestSeedPos = currentSample.xyz;
                }
                
                // JFA sampling pattern
                let step = i32(uniforms.stepSize);
                for (var dz = -step; dz <= step; dz += step) {
                    for (var dy = -step; dy <= step; dy += step) {
                        for (var dx = -step; dx <= step; dx += step) {
                            let sampleCoords3D = vec3<i32>(coords3D) + vec3<i32>(dx, dy, dz);
                            
                            // Check bounds
                            if (sampleCoords3D.x < 0 || sampleCoords3D.x >= i32(uniforms.volumeSize) ||
                                sampleCoords3D.y < 0 || sampleCoords3D.y >= i32(uniforms.volumeSize) ||
                                sampleCoords3D.z < 0 || sampleCoords3D.z >= i32(uniforms.volumeSize)) {
                                continue;
                            }
                            
                            // Convert to 2D atlas coordinates
                            let sampleCoords2D = coords3DTo2D(vec3<u32>(sampleCoords3D));
                            
                            // Sample the texture
                            let sample = textureLoad(inputTexture, sampleCoords2D, 0);
                            
                            if (sample.w > 0.0) {
                                let seedId = u32(sample.z);
                                if (seedId < uniforms.numPoints) {
                                    let seedPos = seedData[seedId].position;
                                    let weight = seedData[seedId].weight;
                                    
                                    let distance = calculateDistance(currentPos, seedPos, weight);
                                    
                                    if (distance < bestDistance) {
                                        bestDistance = distance;
                                        bestSeedId = seedId;
                                        bestSeedPos = seedPos;
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Write result
                let result = vec4<f32>(bestSeedPos, bestDistance);
                textureStore(outputTexture, coords2D, result);
            }
            
            // Initialize seeds
            @compute @workgroup_size(8, 8, 1)
            fn initSeeds(@builtin(global_invocation_id) global_id: vec3<u32>) {
                let coords2D = global_id.xy;
                
                // Check bounds
                if (coords2D.x >= uniforms.atlasSize || coords2D.y >= uniforms.atlasSize) {
                    return;
                }
                
                // Convert to 3D coordinates
                let coords3D = coords2DTo3D(coords2D);
                if (coords3D.z >= uniforms.volumeSize) {
                    return;
                }
                
                // Current position in world space
                let currentPos = vec3<f32>(coords3D) / f32(uniforms.volumeSize - 1u);
                
                // Initialize with no seed
                var result = vec4<f32>(0.0, 0.0, 0.0, 0.0);
                
                // Check if this voxel contains a seed
                for (var i = 0u; i < uniforms.numPoints; i++) {
                    let seedPos = seedData[i].position;
                    let seedWeight = seedData[i].weight;
                    
                    // Check if seed is close to this voxel
                    let distance = calculateDistance(currentPos, seedPos, seedWeight);
                    let voxelSize = 1.0 / f32(uniforms.volumeSize);
                    
                    if (distance < voxelSize) {
                        result = vec4<f32>(seedPos, distance);
                        break;
                    }
                }
                
                textureStore(outputTexture, coords2D, result);
            }
        `;
        
        console.log('📝 JFA WGSL compute shader created');
    }
    
    /**
     * Create storage resources (buffers and textures)
     */
    createStorageResources() {
        // Create uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            size: 32, // 8 u32 values
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Create output texture (storage texture)
        this.outputTexture = this.device.createTexture({
            size: [this.atlasSize, this.atlasSize, 1],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        
        console.log('📦 JFA storage resources created');
    }
    
    /**
     * Create the compute pipeline
     */
    createComputePipeline() {
        // Create shader module
        const shaderModule = this.device.createShaderModule({
            code: this.computeShaderCode,
        });
        
        // Create bind group layout
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: 'write-only',
                        format: 'rgba32float',
                        viewDimension: '2d',
                    },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'float' },
                },
            ],
        });
        
        // Create pipeline layout
        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });
        
        // Create compute pipelines
        this.initPipeline = this.device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: shaderModule,
                entryPoint: 'initSeeds',
            },
        });
        
        this.jfaPipeline = this.device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: shaderModule,
                entryPoint: 'jfaStep',
            },
        });
        
        this.bindGroupLayout = bindGroupLayout;
        
        console.log('🔧 JFA compute pipeline created');
    }
    
    /**
     * Main compute function - runs JFA with current seed data
     */
    async compute(seedData, numPoints) {
        const startTime = performance.now();
        
        try {
            // Update seed buffer
            await this.updateSeedBuffer(seedData, numPoints);
            
            // Run JFA passes
            await this.runJFAPasses();
            
            this.lastComputeTime = Math.round(performance.now() - startTime);
            
            console.log(`✅ JFA compute completed in ${this.lastComputeTime}ms`);
            
        } catch (error) {
            console.error('❌ Error in JFA compute:', error);
            this.lastComputeTime = 0;
        }
    }
    
    /**
     * Update seed buffer with new data
     */
    async updateSeedBuffer(seedData, numPoints) {
        // Create or update seed buffer
        const seedBufferSize = Math.max(numPoints, 1) * 32; // 8 floats per seed
        
        if (!this.seedBuffer || this.seedBuffer.size !== seedBufferSize) {
            this.seedBuffer?.destroy();
            this.seedBuffer = this.device.createBuffer({
                size: seedBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }
        
        // Prepare seed data for GPU
        const seedArray = new Float32Array(numPoints * 8);
        for (let i = 0; i < numPoints; i++) {
            const seed = seedData[i];
            const offset = i * 8;
            
            // Position (vec3)
            seedArray[offset + 0] = seed.x || 0;
            seedArray[offset + 1] = seed.y || 0;
            seedArray[offset + 2] = seed.z || 0;
            
            // Weight (float)
            seedArray[offset + 3] = seed.weight || 1.0;
            
            // Cell ID (u32, stored as float)
            seedArray[offset + 4] = i;
            
            // Padding
            seedArray[offset + 5] = 0;
            seedArray[offset + 6] = 0;
            seedArray[offset + 7] = 0;
        }
        
        // Upload to GPU
        this.device.queue.writeBuffer(this.seedBuffer, 0, seedArray);
        
        // Update uniform buffer
        const uniformArray = new Uint32Array([
            this.volumeSize,
            this.atlasSize,
            this.slicesPerRow,
            1, // stepSize (will be updated per pass)
            numPoints,
            0, 0, 0 // padding
        ]);
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformArray);
    }
    
    /**
     * Run JFA passes with decreasing step sizes
     */
    async runJFAPasses() {
        const commandEncoder = this.device.createCommandEncoder();
        
        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer },
                },
                {
                    binding: 1,
                    resource: { buffer: this.seedBuffer },
                },
                {
                    binding: 2,
                    resource: this.outputTexture.createView(),
                },
                {
                    binding: 3,
                    resource: this.outputTexture.createView(),
                },
            ],
        });
        
        // Initialize seeds
        const initPass = commandEncoder.beginComputePass();
        initPass.setPipeline(this.initPipeline);
        initPass.setBindGroup(0, bindGroup);
        
        const workgroupsX = Math.ceil(this.atlasSize / 8);
        const workgroupsY = Math.ceil(this.atlasSize / 8);
        initPass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
        initPass.end();
        
        // JFA passes with decreasing step sizes
        const maxStepSize = Math.floor(this.volumeSize / 2);
        for (let stepSize = maxStepSize; stepSize >= 1; stepSize = Math.floor(stepSize / 2)) {
            // Update step size in uniform buffer
            const uniformArray = new Uint32Array([
                this.volumeSize,
                this.atlasSize,
                this.slicesPerRow,
                stepSize,
                0, 0, 0, 0
            ]);
            this.device.queue.writeBuffer(this.uniformBuffer, 12, uniformArray.slice(3, 4));
            
            // Run JFA pass
            const jfaPass = commandEncoder.beginComputePass();
            jfaPass.setPipeline(this.jfaPipeline);
            jfaPass.setBindGroup(0, bindGroup);
            jfaPass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
            jfaPass.end();
        }
        
        // Submit commands
        this.device.queue.submit([commandEncoder.finish()]);
    }
    
    /**
     * Get the output texture for rendering
     */
    getOutputTexture() {
        return this.outputTexture;
    }
    
    /**
     * Get output data for CPU analysis (async)
     */
    async getOutputData() {
        if (!this.outputTexture) {
            throw new Error('Output texture not available');
        }
        
        // Create a buffer to read the texture data
        const textureSize = this.atlasSize * this.atlasSize * 4 * 4; // RGBA32F
        const readBuffer = this.device.createBuffer({
            size: textureSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        
        // Copy texture to buffer
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyTextureToBuffer(
            { texture: this.outputTexture },
            { buffer: readBuffer, bytesPerRow: this.atlasSize * 4 * 4 },
            { width: this.atlasSize, height: this.atlasSize, depthOrArrayLayers: 1 }
        );
        
        this.device.queue.submit([commandEncoder.finish()]);
        
        // Map and read the buffer
        await readBuffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = readBuffer.getMappedRange();
        const data = new Float32Array(arrayBuffer);
        
        // Copy data before unmapping
        const result = new Float32Array(data);
        readBuffer.unmap();
        readBuffer.destroy();
        
        return result;
    }
    
    /**
     * Get performance stats
     */
    getPerformanceStats() {
        return {
            jfaTime: this.lastComputeTime,
            volumeSize: this.volumeSize,
            atlasSize: this.atlasSize
        };
    }
    
    /**
     * Clean up resources
     */
    cleanup() {
        this.seedBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.outputTexture?.destroy();
        
        this.seedBuffer = null;
        this.uniformBuffer = null;
        this.outputTexture = null;
        
        console.log('🧹 JFA compute resources cleaned up');
    }
    
    /**
     * Destroy the compute pipeline
     */
    destroy() {
        this.cleanup();
        this.computePipeline = null;
        this.bindGroups = [];
        
        console.log('🗑️ JFA compute pipeline destroyed');
    }
} 