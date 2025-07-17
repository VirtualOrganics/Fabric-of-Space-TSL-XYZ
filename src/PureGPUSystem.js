/**
 * PureGPUSystem.js - True WebGPU-only Voronoi physics system
 * 
 * This is the REAL WebGPU implementation with zero CPU bottlenecks.
 * All data stays on GPU throughout the entire pipeline.
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three';
import { StorageBuffer, Float32Attribute, UInt32Attribute } from 'three';

// Import our GPU compute modules
import { JFACompute } from './JFACompute.js';
import { TSLVolumeRenderer } from './TSLVolumeRenderer.js';

export class PureGPUSystem {
    constructor(container, settings = {}) {
        this.container = container;
        this.settings = {
            volumeResolution: 256,
            numPoints: 100,
            physicsSettings: {
                threshold: 12,
                mode: 'balanced',
                growthRate: 0.1,
                shrinkRate: 0.05,
                momentum: 0.95,
                damping: 0.02,
                maxSpeed: 2.0
            },
            ...settings
        };
        
        this.frameCount = 0;
        this.simulationRunning = false;
        
        // Performance tracking
        this.performanceStats = {
            jfaTime: 0,
            analysisTime: 0,
            physicsTime: 0,
            totalTime: 0,
            fps: 0,
            growingCells: 0,
            shrinkingCells: 0
        };
    }
    
    /**
     * Initialize the pure GPU pipeline
     */
    async initialize() {
        console.log('🚀 Initializing Pure GPU Voronoi System...');
        
        // Create WebGPU renderer
        this.renderer = new WebGPURenderer({ antialias: true });
        await this.renderer.init();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);
        
        // Get WebGPU device
        this.device = this.renderer.backend.device;
        
        // Create scene and camera
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        this.camera = new THREE.PerspectiveCamera(
            75,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            1000
        );
        this.camera.position.set(2, 2, 2);
        this.camera.lookAt(0, 0, 0);
        
        // Initialize GPU buffers
        await this.initializeGPUBuffers();
        
        // Initialize compute pipelines
        await this.initializeComputePipelines();
        
        // Initialize volume renderer
        this.volumeRenderer = new TSLVolumeRenderer(this.scene);
        
        console.log('✅ Pure GPU system initialized');
    }
    
    /**
     * Initialize all GPU buffers that will persist throughout the simulation
     */
    async initializeGPUBuffers() {
        const numPoints = this.settings.numPoints;
        
        // Seed buffer: position (vec3) + velocity (vec3) + radius (float) + padding = 8 floats per seed
        const seedData = new Float32Array(numPoints * 8);
        for (let i = 0; i < numPoints; i++) {
            const offset = i * 8;
            // Random position
            seedData[offset + 0] = Math.random() * 2 - 1;
            seedData[offset + 1] = Math.random() * 2 - 1;
            seedData[offset + 2] = Math.random() * 2 - 1;
            // Zero velocity
            seedData[offset + 3] = 0;
            seedData[offset + 4] = 0;
            seedData[offset + 5] = 0;
            // Initial radius
            seedData[offset + 6] = 0.5;
            // Padding
            seedData[offset + 7] = 0;
        }
        this.seedBuffer = new StorageBuffer(new Float32Attribute(seedData, 8));
        
        // Centroid data buffer: positionSum (vec3) + voxelCount (uint) = 4 floats per cell
        const centroidData = new Float32Array(numPoints * 4);
        this.centroidBuffer = new StorageBuffer(new Float32Attribute(centroidData, 4));
        
        // Acute count buffer: one uint per cell
        const acuteCountData = new Uint32Array(numPoints);
        this.acuteCountBuffer = new StorageBuffer(new UInt32Attribute(acuteCountData, 1));
        
        // Statistics buffer for GPU-computed stats
        const statsData = new Uint32Array(4); // growing, shrinking, total, padding
        this.statsBuffer = new StorageBuffer(new UInt32Attribute(statsData, 4));
        
        console.log('📦 GPU buffers initialized');
    }
    
    /**
     * Initialize compute pipelines
     */
    async initializeComputePipelines() {
        // JFA compute pipeline
        this.jfaCompute = new JFACompute(this.renderer);
        await this.jfaCompute.initialize(this.settings.volumeResolution);
        
        // Analysis compute pipeline
        await this.initializeAnalysisCompute();
        
        // Physics compute pipeline
        await this.initializePhysicsCompute();
        
        console.log('🔧 Compute pipelines initialized');
    }
    
    /**
     * Initialize the analysis compute pipeline
     */
    async initializeAnalysisCompute() {
        const device = this.device;
        
        // Create analysis compute shader
        const analysisShaderCode = `
            struct Seed {
                position: vec3f,
                velocity: vec3f,
                radius: f32,
                padding: f32
            }
            
            struct CentroidData {
                positionSumX: atomic<u32>,
                positionSumY: atomic<u32>,
                positionSumZ: atomic<u32>,
                voxelCount: atomic<u32>
            }
            
            @group(0) @binding(0) var jfaTexture: texture_3d<f32>;
            @group(0) @binding(1) var jfaSampler: sampler;
            @group(0) @binding(2) var<storage, read> seeds: array<Seed>;
            @group(0) @binding(3) var<storage, read_write> centroids: array<CentroidData>;
            @group(0) @binding(4) var<storage, read_write> acuteCounts: array<atomic<u32>>;
            
            @compute @workgroup_size(4, 4, 4)
            fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                let dims = textureDimensions(jfaTexture);
                if (id.x >= dims.x || id.y >= dims.y || id.z >= dims.z) {
                    return;
                }
                
                // Sample JFA texture to get cell ID
                let texCoord = vec3f(id) / vec3f(dims);
                let jfaValue = textureSampleLevel(jfaTexture, jfaSampler, texCoord, 0.0);
                let cellId = u32(jfaValue.w * f32(arrayLength(&seeds)));
                
                if (cellId >= arrayLength(&seeds)) {
                    return;
                }
                
                // Accumulate centroid data using fixed-point arithmetic
                // We use the raw voxel coordinates directly (already integers)
                atomicAdd(&centroids[cellId].positionSumX, id.x);
                atomicAdd(&centroids[cellId].positionSumY, id.y);
                atomicAdd(&centroids[cellId].positionSumZ, id.z);
                atomicAdd(&centroids[cellId].voxelCount, 1u);
                
                // Check for junctions and calculate angles
                // Sample 2x2x2 neighborhood
                var uniqueCells: array<u32, 8>;
                var numUnique = 0u;
                
                for (var dz = 0u; dz <= 1u; dz++) {
                    for (var dy = 0u; dy <= 1u; dy++) {
                        for (var dx = 0u; dx <= 1u; dx++) {
                            let samplePos = id + vec3u(dx, dy, dz);
                            if (samplePos.x < dims.x && samplePos.y < dims.y && samplePos.z < dims.z) {
                                let sampleCoord = vec3f(samplePos) / vec3f(dims);
                                let sampleValue = textureSampleLevel(jfaTexture, jfaSampler, sampleCoord, 0.0);
                                let sampleCell = u32(sampleValue.w * f32(arrayLength(&seeds)));
                                
                                // Check if this cell is unique
                                var isUnique = true;
                                for (var i = 0u; i < numUnique; i++) {
                                    if (uniqueCells[i] == sampleCell) {
                                        isUnique = false;
                                        break;
                                    }
                                }
                                if (isUnique && numUnique < 8u) {
                                    uniqueCells[numUnique] = sampleCell;
                                    numUnique++;
                                }
                            }
                        }
                    }
                }
                
                // If we have 3 or more unique cells, this is a junction
                if (numUnique >= 3u) {
                    // Calculate angles and update acute counts
                    let junctionPos = (vec3f(id) + vec3f(0.5)) / vec3f(dims) * 2.0 - 1.0;
                    
                    for (var i = 0u; i < numUnique; i++) {
                        for (var j = i + 1u; j < numUnique; j++) {
                            let cellA = uniqueCells[i];
                            let cellB = uniqueCells[j];
                            
                            if (cellA < arrayLength(&seeds) && cellB < arrayLength(&seeds)) {
                                let vecA = normalize(seeds[cellA].position - junctionPos);
                                let vecB = normalize(seeds[cellB].position - junctionPos);
                                let angle = acos(clamp(dot(vecA, vecB), -1.0, 1.0));
                                
                                // If angle is acute (< 90 degrees)
                                if (angle < 1.5708) {
                                    atomicAdd(&acuteCounts[cellA], 1u);
                                    atomicAdd(&acuteCounts[cellB], 1u);
                                }
                            }
                        }
                    }
                }
            }
        `;
        
        // Create shader module
        const shaderModule = device.createShaderModule({
            label: 'Analysis Compute Shader',
            code: analysisShaderCode
        });
        
        // Create compute pipeline
        this.analysisComputePipeline = device.createComputePipeline({
            label: 'Analysis Compute Pipeline',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'main'
            }
        });
        
        // Create sampler for JFA texture
        this.jfaSampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear'
        });
        
        // Create centroid finalization compute shader
        const finalizationShaderCode = `
            struct CentroidDataAtomic {
                positionSumX: atomic<u32>,
                positionSumY: atomic<u32>,
                positionSumZ: atomic<u32>,
                voxelCount: atomic<u32>
            }
            
            struct CentroidDataFloat {
                positionSum: vec3f,
                voxelCount: f32
            }
            
            @group(0) @binding(0) var<storage, read> atomicCentroids: array<CentroidDataAtomic>;
            @group(0) @binding(1) var<storage, read_write> floatCentroids: array<CentroidDataFloat>;
            @group(0) @binding(2) var<uniform> volumeSize: u32;
            
            @compute @workgroup_size(64)
            fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                let cellId = id.x;
                if (cellId >= arrayLength(&floatCentroids)) {
                    return;
                }
                
                // Read atomic values
                let sumX = f32(atomicLoad(&atomicCentroids[cellId].positionSumX));
                let sumY = f32(atomicLoad(&atomicCentroids[cellId].positionSumY));
                let sumZ = f32(atomicLoad(&atomicCentroids[cellId].positionSumZ));
                let voxelCount = f32(atomicLoad(&atomicCentroids[cellId].voxelCount));
                
                // Convert to world space centroid
                if (voxelCount > 0.0) {
                    let centroid = vec3f(sumX, sumY, sumZ) / voxelCount;
                    // Convert from voxel coordinates to world coordinates [-1, 1]
                    floatCentroids[cellId].positionSum = (centroid / f32(volumeSize)) * 2.0 - 1.0;
                    floatCentroids[cellId].voxelCount = voxelCount;
                } else {
                    floatCentroids[cellId].positionSum = vec3f(0.0);
                    floatCentroids[cellId].voxelCount = 0.0;
                }
            }
        `;
        
        // Create finalization shader module
        const finalizationModule = device.createShaderModule({
            label: 'Centroid Finalization Shader',
            code: finalizationShaderCode
        });
        
        // Create finalization pipeline
        this.centroidFinalizationPipeline = device.createComputePipeline({
            label: 'Centroid Finalization Pipeline',
            layout: 'auto',
            compute: {
                module: finalizationModule,
                entryPoint: 'main'
            }
        });
        
        // Create volume size uniform buffer
        this.volumeSizeBuffer = device.createBuffer({
            label: 'Volume Size Buffer',
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Uint32Array(this.volumeSizeBuffer.getMappedRange()).set([this.settings.volumeResolution]);
        this.volumeSizeBuffer.unmap();
        
        // Create float centroid buffer for finalized data
        const floatCentroidData = new Float32Array(this.settings.numPoints * 4);
        this.floatCentroidBuffer = new StorageBuffer(new Float32Attribute(floatCentroidData, 4));
        
        console.log('🔬 Analysis compute pipeline created');
    }
    
    /**
     * Initialize the physics compute pipeline
     */
    async initializePhysicsCompute() {
        const device = this.device;
        
        // Create physics compute shader
        const physicsShaderCode = `
            struct Seed {
                position: vec3f,
                velocity: vec3f,
                radius: f32,
                padding: f32
            }
            
            struct CentroidData {
                positionSum: vec3f,
                voxelCount: f32
            }
            
            struct PhysicsSettings {
                threshold: f32,
                growthRate: f32,
                shrinkRate: f32,
                momentum: f32,
                damping: f32,
                maxSpeed: f32,
                mode: u32,  // 0=balanced, 1=growthOnly, 2=shrinkOnly, 3=inverse
                deltaTime: f32
            }
            
            struct Stats {
                growing: atomic<u32>,
                shrinking: atomic<u32>,
                total: atomic<u32>,
                padding: u32
            }
            
            @group(0) @binding(0) var<storage, read_write> seeds: array<Seed>;
            @group(0) @binding(1) var<storage, read> centroids: array<CentroidData>;
            @group(0) @binding(2) var<storage, read> acuteCounts: array<u32>;
            @group(0) @binding(3) var<uniform> settings: PhysicsSettings;
            @group(0) @binding(4) var<storage, read_write> stats: Stats;
            
            @compute @workgroup_size(64)
            fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                let cellId = id.x;
                if (cellId >= arrayLength(&seeds)) {
                    return;
                }
                
                // Clear stats on first thread
                if (cellId == 0u) {
                    atomicStore(&stats.growing, 0u);
                    atomicStore(&stats.shrinking, 0u);
                    atomicStore(&stats.total, arrayLength(&seeds));
                }
                workgroupBarrier();
                
                var seed = seeds[cellId];
                let centroidData = centroids[cellId];
                let acuteCount = acuteCounts[cellId];
                
                // Calculate centroid if we have voxels
                if (centroidData.voxelCount > 0.0) {
                    // The centroid has already been finalized to world coordinates
                    let centroid = centroidData.positionSum;
                    let delta = centroid - seed.position;
                    
                    // Only proceed if we have a valid direction vector
                    let distance = length(delta);
                    if (distance > 0.001) {
                        let direction = delta / distance; // Manual normalization to avoid issues
                        
                        // Determine growth/shrink based on acute count and mode
                        var shouldGrow = false;
                        var shouldShrink = false;
                        
                        let threshold = u32(settings.threshold);
                        
                        switch (settings.mode) {
                            case 0u: { // balanced
                                shouldGrow = acuteCount < threshold;
                                shouldShrink = acuteCount > threshold;
                            }
                            case 1u: { // growthOnly
                                shouldGrow = acuteCount < threshold;
                            }
                            case 2u: { // shrinkOnly
                                shouldShrink = acuteCount > threshold;
                            }
                            case 3u: { // inverse
                                shouldGrow = acuteCount > threshold;
                                shouldShrink = acuteCount < threshold;
                            }
                            default: {}
                        }
                        
                        // Apply forces
                        var force = vec3f(0.0);
                        if (shouldGrow) {
                            // GROW: Move seed AWAY from centroid to expand the cell
                            force = -direction * settings.growthRate;
                            atomicAdd(&stats.growing, 1u);
                        } else if (shouldShrink) {
                            // SHRINK: Move seed TOWARD centroid to contract the cell
                            force = direction * settings.shrinkRate;
                            atomicAdd(&stats.shrinking, 1u);
                        }
                        
                        // Update velocity with momentum and damping
                        seed.velocity = seed.velocity * settings.momentum + force;
                        seed.velocity = seed.velocity * (1.0 - settings.damping);
                        
                        // Clamp velocity
                        let speed = length(seed.velocity);
                        if (speed > settings.maxSpeed) {
                            seed.velocity = normalize(seed.velocity) * settings.maxSpeed;
                        }
                        
                        // Update position
                        seed.position = seed.position + seed.velocity * settings.deltaTime;
                        
                        // Keep seeds in bounds [-1, 1]
                        seed.position = clamp(seed.position, vec3f(-1.0), vec3f(1.0));
                    }
                }
                
                // Write back updated seed
                seeds[cellId] = seed;
            }
        `;
        
        // Create shader module
        const shaderModule = device.createShaderModule({
            label: 'Physics Compute Shader',
            code: physicsShaderCode
        });
        
        // Create compute pipeline
        this.physicsComputePipeline = device.createComputePipeline({
            label: 'Physics Compute Pipeline',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'main'
            }
        });
        
        // Create physics settings uniform buffer
        const settingsData = new Float32Array([
            this.settings.physicsSettings.threshold,
            this.settings.physicsSettings.growthRate,
            this.settings.physicsSettings.shrinkRate,
            this.settings.physicsSettings.momentum,
            this.settings.physicsSettings.damping,
            this.settings.physicsSettings.maxSpeed,
            0, // mode (will be set per frame)
            0  // deltaTime (will be set per frame)
        ]);
        
        this.physicsSettingsBuffer = device.createBuffer({
            label: 'Physics Settings Buffer',
            size: settingsData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Float32Array(this.physicsSettingsBuffer.getMappedRange()).set(settingsData);
        this.physicsSettingsBuffer.unmap();
        
        console.log('🌊 Physics compute pipeline created');
    }
    
    /**
     * Main update loop - Pure GPU pipeline
     */
    async update(deltaTime) {
        if (!this.simulationRunning) return;
        
        const startTime = performance.now();
        
        // Update physics settings
        const modeMap = {
            'balanced': 0,
            'growthOnly': 1,
            'shrinkOnly': 2,
            'inverse': 3
        };
        
        const settingsData = new Float32Array([
            this.settings.physicsSettings.threshold,
            this.settings.physicsSettings.growthRate,
            this.settings.physicsSettings.shrinkRate,
            this.settings.physicsSettings.momentum,
            this.settings.physicsSettings.damping,
            this.settings.physicsSettings.maxSpeed,
            modeMap[this.settings.physicsSettings.mode] || 0,
            deltaTime
        ]);
        this.device.queue.writeBuffer(this.physicsSettingsBuffer, 0, settingsData);
        
        // Create command encoder
        const commandEncoder = this.device.createCommandEncoder();
        
        // Pass 1: JFA Compute
        const jfaStart = performance.now();
        await this.jfaCompute.computeWithBuffer(this.seedBuffer, this.settings.numPoints);
        this.performanceStats.jfaTime = Math.round(performance.now() - jfaStart);
        
        // Pass 2: Analysis Compute
        const analysisStart = performance.now();
        
        // Clear buffers
        commandEncoder.clearBuffer(this.centroidBuffer, 0);
        commandEncoder.clearBuffer(this.acuteCountBuffer, 0);
        
        // Run analysis compute pass
        const analysisPass = commandEncoder.beginComputePass();
        analysisPass.setPipeline(this.analysisComputePipeline);
        
        const analysisBindGroup = this.device.createBindGroup({
            layout: this.analysisComputePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.jfaCompute.getOutputTexture().createView() },
                { binding: 1, resource: this.jfaSampler },
                { binding: 2, resource: { buffer: this.seedBuffer.buffer } },
                { binding: 3, resource: { buffer: this.centroidBuffer.buffer } },
                { binding: 4, resource: { buffer: this.acuteCountBuffer.buffer } }
            ]
        });
        
        analysisPass.setBindGroup(0, analysisBindGroup);
        const workgroupsPerDim = Math.ceil(this.settings.volumeResolution / 4);
        analysisPass.dispatchWorkgroups(workgroupsPerDim, workgroupsPerDim, workgroupsPerDim);
        analysisPass.end();
        
        this.performanceStats.analysisTime = Math.round(performance.now() - analysisStart);
        
        // Pass 3: Centroid Finalization
        const finalizationStart = performance.now();
        
        const finalizationPass = commandEncoder.beginComputePass();
        finalizationPass.setPipeline(this.centroidFinalizationPipeline);
        
        const finalizationBindGroup = this.device.createBindGroup({
            layout: this.centroidFinalizationPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.centroidBuffer.buffer } }, // Atomic centroids
                { binding: 1, resource: { buffer: this.floatCentroidBuffer.buffer } }, // Float centroids
                { binding: 2, resource: { buffer: this.volumeSizeBuffer } } // Volume size
            ]
        });
        
        finalizationPass.setBindGroup(0, finalizationBindGroup);
        const finalizationWorkgroups = Math.ceil(this.settings.numPoints / 64);
        finalizationPass.dispatchWorkgroups(finalizationWorkgroups);
        finalizationPass.end();
        
        this.performanceStats.analysisTime += Math.round(performance.now() - finalizationStart);
        
        // Pass 4: Physics Compute
        const physicsStart = performance.now();
        
        const physicsPass = commandEncoder.beginComputePass();
        physicsPass.setPipeline(this.physicsComputePipeline);
        
        const physicsBindGroup = this.device.createBindGroup({
            layout: this.physicsComputePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.seedBuffer.buffer } },
                { binding: 1, resource: { buffer: this.floatCentroidBuffer.buffer } }, // Use finalized float centroids
                { binding: 2, resource: { buffer: this.acuteCountBuffer.buffer } },
                { binding: 3, resource: { buffer: this.physicsSettingsBuffer } },
                { binding: 4, resource: { buffer: this.statsBuffer.buffer } }
            ]
        });
        
        physicsPass.setBindGroup(0, physicsBindGroup);
        const physicsWorkgroups = Math.ceil(this.settings.numPoints / 64);
        physicsPass.dispatchWorkgroups(physicsWorkgroups);
        physicsPass.end();
        
        this.performanceStats.physicsTime = Math.round(performance.now() - physicsStart);
        
        // Submit all compute passes
        this.device.queue.submit([commandEncoder.finish()]);
        
        // Pass 5: Render (using GPU data directly)
        if (this.volumeRenderer) {
            this.volumeRenderer.updateVolume(
                this.jfaCompute.getOutputTexture(),
                this.settings.volumeResolution,
                Math.ceil(Math.sqrt(this.settings.volumeResolution))
            );
        }
        
        this.renderer.render(this.scene, this.camera);
        
        // Update performance stats
        this.performanceStats.totalTime = Math.round(performance.now() - startTime);
        this.performanceStats.fps = Math.round(1000 / this.performanceStats.totalTime);
        
        this.frameCount++;
        
        // Optionally read stats every N frames (small data transfer for UI only)
        if (this.frameCount % 30 === 0) {
            await this.readStatistics();
        }
    }
    
    /**
     * Read statistics from GPU (only for UI display)
     */
    async readStatistics() {
        // Create a staging buffer to read stats
        const stagingBuffer = this.device.createBuffer({
            size: 16, // 4 uint32s
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(
            this.statsBuffer.buffer, 0,
            stagingBuffer, 0,
            16
        );
        this.device.queue.submit([commandEncoder.finish()]);
        
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const data = new Uint32Array(stagingBuffer.getMappedRange());
        this.performanceStats.growingCells = data[0];
        this.performanceStats.shrinkingCells = data[1];
        stagingBuffer.unmap();
        stagingBuffer.destroy();
    }
    
    /**
     * Start the simulation
     */
    start() {
        this.simulationRunning = true;
        console.log('▶️ Pure GPU simulation started');
    }
    
    /**
     * Stop the simulation
     */
    stop() {
        this.simulationRunning = false;
        console.log('⏸️ Pure GPU simulation stopped');
    }
    
    /**
     * Clean up resources
     */
    destroy() {
        this.simulationRunning = false;
        
        // Clean up GPU resources
        this.seedBuffer?.destroy();
        this.centroidBuffer?.destroy();
        this.acuteCountBuffer?.destroy();
        this.statsBuffer?.destroy();
        this.physicsSettingsBuffer?.destroy();
        this.volumeSizeBuffer?.destroy();
        this.floatCentroidBuffer?.destroy();
        
        // Clean up compute pipelines
        this.jfaCompute?.destroy();
        this.analysisComputePipeline?.destroy();
        this.centroidFinalizationPipeline?.destroy();
        
        // Clean up renderer
        this.renderer?.dispose();
        
        console.log('🗑️ Pure GPU system destroyed');
    }
} 