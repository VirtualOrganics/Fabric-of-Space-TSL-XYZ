import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

/**
 * GPUVoronoiCompute - Adapts JFA-3D-Voronoi-Atlas for the hybrid system
 * 
 * This class implements the GPU-based Voronoi generation using Jump Flooding Algorithm
 * Modified to work with our seed texture approach from Phase 1
 */
export class GPUVoronoiCompute {
    constructor() {
        this.renderer = null;
        this.gpuCompute = null;
        this.jfaVariable = null;
        this.volumeSize = 64;
        this.atlasSize = 0;
        this.slicesPerRow = 0;
        this.currentRenderTarget = null;
        
        // Performance tracking
        this.lastComputeTime = 0;
        
        console.log('🖥️ GPUVoronoiCompute constructor completed');
    }
    
    /**
     * Initialize the GPU compute system
     */
    async init() {
        console.log('🚀 Initializing GPU Voronoi compute...');
        
        try {
            // Get renderer from global scope (passed from main app)
            this.renderer = window.renderer;
            if (!this.renderer) {
                throw new Error('Renderer not found in global scope');
            }
            
            // Calculate atlas parameters
            this.updateVolumeParameters();
            
            console.log(`✅ GPU Voronoi compute initialized with ${this.volumeSize}³ volume`);
            
        } catch (error) {
            console.error('❌ Failed to initialize GPU Voronoi compute:', error);
            throw error;
        }
    }
    
    /**
     * Update volume parameters based on current settings
     */
    updateVolumeParameters() {
        this.slicesPerRow = Math.ceil(Math.sqrt(this.volumeSize));
        this.atlasSize = this.volumeSize * this.slicesPerRow;
        
        console.log(`📐 Volume parameters updated: ${this.volumeSize}³ → ${this.atlasSize}² atlas`);
    }
    
    /**
     * Set the volume resolution
     */
    setResolution(resolution) {
        this.volumeSize = resolution;
        this.updateVolumeParameters();
        
        // Clean up existing GPU compute resources
        this.cleanup();
        
        console.log(`🔧 Resolution set to ${resolution}³`);
    }
    
    /**
     * Main compute function - runs JFA with current seed data
     */
    compute(seedTexture, seedTextureSize, numPoints) {
        const startTime = performance.now();
        
        try {
            // Initialize GPU compute if needed
            if (!this.gpuCompute) {
                this.initGPUCompute(seedTexture, seedTextureSize, numPoints);
            } else {
                // Update seed data in existing compute
                this.updateSeedData(seedTexture, seedTextureSize, numPoints);
            }
            
            // Run JFA passes
            this.runJFA();
            
            this.lastComputeTime = Math.round(performance.now() - startTime);
            
        } catch (error) {
            console.error('❌ Error in GPU compute:', error);
            this.lastComputeTime = 0;
        }
    }
    
    /**
     * Initialize GPU computation renderer and variables
     */
    initGPUCompute(seedTexture, seedTextureSize, numPoints) {
        console.log('🔧 Initializing GPU compute renderer...');
        
        // Clean up existing resources
        this.cleanup();
        
        // Create GPU compute renderer
        this.gpuCompute = new GPUComputationRenderer(this.atlasSize, this.atlasSize, this.renderer);
        
        // Create initial texture with seed data
        const initialTexture = this.createInitialTexture(seedTexture, seedTextureSize, numPoints);
        
        // Create JFA variable with our modified shader
        this.jfaVariable = this.gpuCompute.addVariable('textureJFA', this.getJFAShader(), initialTexture);
        this.gpuCompute.setVariableDependencies(this.jfaVariable, [this.jfaVariable]);
        
        // Set shader uniforms
        this.jfaVariable.material.uniforms['uStepSize'] = { value: 0.0 };
        this.jfaVariable.material.uniforms['uVolumeSize'] = { value: this.volumeSize };
        this.jfaVariable.material.uniforms['uSlicesPerRow'] = { value: this.slicesPerRow };
        this.jfaVariable.material.uniforms['uSeedTexture'] = { value: seedTexture };
        this.jfaVariable.material.uniforms['uSeedTextureSize'] = { value: seedTextureSize };
        this.jfaVariable.material.uniforms['uNumPoints'] = { value: numPoints };
        
        // Initialize GPU compute
        const error = this.gpuCompute.init();
        if (error !== null) {
            console.error('❌ GPU compute initialization failed:', error);
            throw new Error('GPU compute initialization failed: ' + error);
        }
        
        console.log('✅ GPU compute renderer initialized');
    }
    
    /**
     * Create initial texture with seed data from our seed texture
     */
    createInitialTexture(seedTexture, seedTextureSize, numPoints) {
        console.log('🖼️ Creating initial JFA texture...');
        
        const initialTexture = this.gpuCompute.createTexture();
        const data = initialTexture.image.data;
        
        // Clear all data first
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 0.0;      // x
            data[i + 1] = 0.0;  // y
            data[i + 2] = 0.0;  // z
            data[i + 3] = 0.0;  // seed ID (0 = no seed)
        }
        
        // Extract seed data from our seed texture
        const seedData = seedTexture.image.data;
        
        // Plant seeds in the atlas
        for (let i = 0; i < numPoints; i++) {
            const seedIndex = i * 4;
            
            // Get seed position and weight from our seed texture
            const seedX = seedData[seedIndex];
            const seedY = seedData[seedIndex + 1];
            const seedZ = seedData[seedIndex + 2];
            const seedWeight = seedData[seedIndex + 3];
            
            // Convert from [-1, 1] to [0, 1] range
            const volumePos = new THREE.Vector3(
                (seedX + 1) * 0.5,
                (seedY + 1) * 0.5,
                (seedZ + 1) * 0.5
            );
            
            // Convert 3D position to atlas coordinates
            const z = Math.floor(volumePos.z * this.volumeSize);
            const sliceX = z % this.slicesPerRow;
            const sliceY = Math.floor(z / this.slicesPerRow);
            
            const atlasX = Math.floor((sliceX + volumePos.x) * this.volumeSize);
            const atlasY = Math.floor((sliceY + volumePos.y) * this.volumeSize);
            
            // Plant seed in atlas if within bounds
            if (atlasX >= 0 && atlasX < this.atlasSize && atlasY >= 0 && atlasY < this.atlasSize) {
                const index = (atlasY * this.atlasSize + atlasX) * 4;
                data[index] = volumePos.x;
                data[index + 1] = volumePos.y;
                data[index + 2] = volumePos.z;
                data[index + 3] = (i + 1) / numPoints; // Normalized seed ID
            }
        }
        
        console.log(`✅ Initial texture created with ${numPoints} seeds`);
        return initialTexture;
    }
    
    /**
     * Update seed data in existing GPU compute
     */
    updateSeedData(seedTexture, seedTextureSize, numPoints) {
        // Update uniforms with new seed data
        this.jfaVariable.material.uniforms.uSeedTexture.value = seedTexture;
        this.jfaVariable.material.uniforms.uSeedTextureSize.value = seedTextureSize;
        this.jfaVariable.material.uniforms.uNumPoints.value = numPoints;
        
        // Recreate initial texture with new seed data
        const initialTexture = this.createInitialTexture(seedTexture, seedTextureSize, numPoints);
        
        // Update the JFA variable with new initial data
        // This is a bit tricky - we need to reset the computation
        this.cleanup();
        this.initGPUCompute(seedTexture, seedTextureSize, numPoints);
    }
    
    /**
     * Run the Jump Flooding Algorithm
     */
    runJFA() {
        console.log('🏃 Running JFA passes...');
        
        const numPasses = Math.ceil(Math.log2(this.volumeSize));
        let stepSize = Math.pow(2, numPasses - 1);
        
        for (let i = 0; i < numPasses; i++) {
            // Set step size for this pass
            this.jfaVariable.material.uniforms.uStepSize.value = stepSize;
            
            // Run compute pass
            this.gpuCompute.compute();
            
            // Halve step size for next pass
            stepSize = Math.max(1, Math.floor(stepSize / 2));
        }
        
        // Store current render target for output
        this.currentRenderTarget = this.gpuCompute.getCurrentRenderTarget(this.jfaVariable);
        
        console.log(`✅ JFA completed with ${numPasses} passes`);
    }
    
    /**
     * Get the JFA shader code adapted for our weighted approach
     */
    getJFAShader() {
        return `
            uniform float uStepSize;
            uniform float uVolumeSize;
            uniform float uSlicesPerRow;
            uniform sampler2D uSeedTexture;
            uniform vec2 uSeedTextureSize;
            uniform int uNumPoints;
            
            // Convert 3D coordinates to 2D atlas UV
            vec2 volumeToAtlas(vec3 pos) {
                float slice = floor(pos.z * uVolumeSize);
                float sliceX = mod(slice, uSlicesPerRow);
                float sliceY = floor(slice / uSlicesPerRow);
                
                vec2 atlasPos = vec2(
                    (sliceX + pos.x) / uSlicesPerRow,
                    (sliceY + pos.y) / uSlicesPerRow
                );
                return atlasPos;
            }
            
            // Convert 2D atlas UV to 3D coordinates
            vec3 atlasToVolume(vec2 uv) {
                vec2 scaledUV = uv * uSlicesPerRow;
                float sliceX = floor(scaledUV.x);
                float sliceY = floor(scaledUV.y);
                float slice = sliceY * uSlicesPerRow + sliceX;
                
                vec2 inSliceUV = fract(scaledUV);
                return vec3(inSliceUV.x, inSliceUV.y, slice / uVolumeSize);
            }
            
            // Sample volume with bounds checking
            vec4 sampleVolume(sampler2D tex, vec3 pos) {
                if (any(lessThan(pos, vec3(0.0))) || any(greaterThan(pos, vec3(1.0)))) {
                    return vec4(0.0);
                }
                return texture2D(tex, volumeToAtlas(pos));
            }
            
            // Get seed data from our seed texture
            vec4 getSeedData(int index) {
                float y = floor(float(index) / uSeedTextureSize.x);
                float x = mod(float(index), uSeedTextureSize.x);
                vec2 uv = (vec2(x, y) + 0.5) / uSeedTextureSize;
                return texture2D(uSeedTexture, uv);
            }
            
            void main() {
                vec2 uv = gl_FragCoord.xy / resolution.xy;
                vec3 volumePos = atlasToVolume(uv);
                vec4 current = texture2D(textureJFA, uv);
                
                // Only process voxels that are inside our volume
                if (volumePos.z > 1.0) {
                    gl_FragColor = vec4(0.0);
                    return;
                }
                
                vec3 step3D = vec3(uStepSize) / uVolumeSize;
                
                // Check 26 neighbors in 3D space
                for (int z = -1; z <= 1; z++) {
                    for (int y = -1; y <= 1; y++) {
                        for (int x = -1; x <= 1; x++) {
                            if (x == 0 && y == 0 && z == 0) continue;
                            
                            vec3 neighborPos = volumePos + vec3(x, y, z) * step3D;
                            vec4 neighbor = sampleVolume(textureJFA, neighborPos);
                            
                            // If neighbor has no seed, skip
                            if (neighbor.w < 0.5) continue;
                            
                            // If we have no seed, take neighbor's
                            if (current.w < 0.5) {
                                current = neighbor;
                                continue;
                            }
                            
                            // For weighted Voronoi, we need to get the actual seed data
                            // to access the weight information
                            int currentSeedIndex = int(current.w * float(uNumPoints)) - 1;
                            int neighborSeedIndex = int(neighbor.w * float(uNumPoints)) - 1;
                            
                            if (currentSeedIndex >= 0 && currentSeedIndex < uNumPoints &&
                                neighborSeedIndex >= 0 && neighborSeedIndex < uNumPoints) {
                                
                                vec4 currentSeedData = getSeedData(currentSeedIndex);
                                vec4 neighborSeedData = getSeedData(neighborSeedIndex);
                                
                                // Convert seed positions from [-1,1] to [0,1] range
                                vec3 currentSeedPos = (currentSeedData.xyz + 1.0) * 0.5;
                                vec3 neighborSeedPos = (neighborSeedData.xyz + 1.0) * 0.5;
                                
                                // Calculate weighted distances (additive weighted Voronoi)
                                float distToCurrent = distance(currentSeedPos, volumePos);
                                float distToNeighbor = distance(neighborSeedPos, volumePos);
                                
                                // Apply weights (additive: distance - weight)
                                float weightedDistCurrent = distToCurrent - currentSeedData.w;
                                float weightedDistNeighbor = distToNeighbor - neighborSeedData.w;
                                
                                // Choose the seed with smaller weighted distance
                                if (weightedDistNeighbor < weightedDistCurrent) {
                                    current = neighbor;
                                }
                            } else {
                                // Fallback to unweighted comparison
                                float distToCurrent = distance(current.xyz, volumePos);
                                float distToNeighbor = distance(neighbor.xyz, volumePos);
                                
                                if (distToNeighbor < distToCurrent) {
                                    current = neighbor;
                                }
                            }
                        }
                    }
                }
                
                gl_FragColor = current;
            }
        `;
    }
    
    /**
     * Get the output data from GPU computation
     */
    getOutputData() {
        if (!this.currentRenderTarget) {
            console.warn('⚠️ No render target available for output');
            return null;
        }
        
        // Read pixels from GPU back to CPU
        const buffer = new Float32Array(this.atlasSize * this.atlasSize * 4);
        this.renderer.readRenderTargetPixels(
            this.currentRenderTarget, 
            0, 0, 
            this.atlasSize, 
            this.atlasSize, 
            buffer
        );
        
        return {
            data: buffer,
            width: this.atlasSize,
            height: this.atlasSize,
            volumeSize: this.volumeSize,
            slicesPerRow: this.slicesPerRow
        };
    }
    
    /**
     * Get the current render target for visualization
     */
    getCurrentRenderTarget() {
        return this.currentRenderTarget;
    }
    
    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        return {
            lastComputeTime: this.lastComputeTime,
            volumeSize: this.volumeSize,
            atlasSize: this.atlasSize
        };
    }
    
    /**
     * Clean up GPU resources
     */
    cleanup() {
        if (this.gpuCompute && this.jfaVariable) {
            // Dispose of render targets
            if (this.jfaVariable.renderTargets) {
                this.jfaVariable.renderTargets.forEach(rt => {
                    if (rt && rt.texture) rt.texture.dispose();
                    if (rt) rt.dispose();
                });
            }
            
            // Clear current render target reference
            this.currentRenderTarget = null;
        }
        
        // Clear GPU compute reference
        this.gpuCompute = null;
        this.jfaVariable = null;
        
        console.log('🧹 GPU compute resources cleaned up');
    }
    
    /**
     * Dispose of all resources
     */
    dispose() {
        console.log('🧹 Disposing GPUVoronoiCompute...');
        
        this.cleanup();
        
        console.log('✅ GPUVoronoiCompute disposed');
    }
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.GPUVoronoiCompute = GPUVoronoiCompute;
} 