import * as THREE from 'three';
import { GPUVoronoiCompute } from './GPUVoronoiCompute.js';
import { JFACompute } from './JFACompute.js';
import { VoronoiAnalyzer } from './VoronoiAnalyzer.js';
import { AnalysisCompute } from './AnalysisCompute.js';
import { PhysicsEngine } from './PhysicsEngine.js';
import { PhysicsCompute } from './PhysicsCompute.js';
import { VolumeRenderer } from './VolumeRenderer.js';
import { TSLVolumeRenderer } from './TSLVolumeRenderer.js';
import { ColorLegend } from './ColorLegend.js';

/**
 * HybridVoronoiSystem - Main class that coordinates the hybrid JFA + Physics pipeline
 * 
 * This class implements the core architecture described in the plan:
 * 1. GPU-based JFA generates Voronoi diagrams quickly
 * 2. CPU analyzer reads JFA output and calculates acute angles
 * 3. Physics engine updates cell weights based on angle counts
 * 4. Loop continues with updated weights fed back to GPU
 */
export class HybridVoronoiSystem {
    constructor() {
        // Core state management as described in Phase 1
        this.numPoints = 50;
        this.seedData = [];
        this.simulationRunning = false;
        this.physicsEnabled = true; // Enable physics by default
        
        // GPU compute components
        this.gpuCompute = null;
        this.seedTexture = null;
        this.seedTextureSize = new THREE.Vector2();
        
        // CPU analysis components
        this.analyzer = null;
        this.analysisCompute = null;
        this.physicsEngine = null;
        this.physicsCompute = null;
        
        // Visualization components
        this.scene = null;
        this.meshGroup = null;
        this.pointsGroup = null;
        this.volumeRenderer = null;
        this.tslVolumeRenderer = null;
        this.colorLegend = null;
        
        // Debug visualization components
        this.debugGroup = null;
        
        // Performance tracking
        this.performanceStats = {
            jfaTime: 0,
            analysisTime: 0,
            physicsTime: 0,
            growingCells: 0,
            shrinkingCells: 0
        };
        
        // Settings
        this.settings = {
            volumeResolution: 64,
            transparency: 0.7,
            showEdges: true,
            showPoints: true,
            colorByAcuteness: true,
            periodicBoundaries: false,
            pointSize: 3.0,
            showDebugVisuals: true,
            physicsSettings: {
                threshold: 10,
                growthRate: 0.001,
                forceStrength: 1.0,
                mode: 'balanced'
            }
        };
        
        console.log('🏗️ HybridVoronoiSystem constructor completed');
    }
    
    /**
     * Detect if the current renderer is WebGPU
     */
    isWebGPURenderer() {
        const renderer = window.renderer;
        if (!renderer) return false;
        
        // Check if renderer has WebGPU-specific methods
        return typeof renderer.getDevice === 'function' || 
               renderer.constructor.name === 'WebGPURenderer' ||
               renderer.isWebGPURenderer === true;
    }
    
    /**
     * Initialize the hybrid system
     */
    async init() {
        console.log('🚀 Initializing HybridVoronoiSystem...');
        
        try {
            // Detect renderer type and initialize appropriate compute system
            const isWebGPU = this.isWebGPURenderer();
            
            if (isWebGPU) {
                console.log('🔧 Using WebGPU compute pipeline (JFACompute)');
                this.gpuCompute = new JFACompute(window.renderer);
                await this.gpuCompute.init();
            } else {
                console.log('🔧 Using WebGL compute pipeline (GPUVoronoiCompute)');
                this.gpuCompute = new GPUVoronoiCompute();
                await this.gpuCompute.init();
            }
            
            // Initialize CPU analyzer (fallback for WebGL)
            this.analyzer = new VoronoiAnalyzer();
            
            // Initialize WebGPU analysis compute if available
            if (this.isWebGPURenderer()) {
                this.analysisCompute = new AnalysisCompute(window.renderer);
                await this.analysisCompute.init();
            }
            
            // Initialize physics engine (fallback for WebGL)
            this.physicsEngine = new PhysicsEngine();
            
            // Initialize WebGPU physics compute if available
            if (this.isWebGPURenderer()) {
                this.physicsCompute = new PhysicsCompute(window.renderer);
                await this.physicsCompute.init();
            }
            
            // Initialize volume renderer
            this.volumeRenderer = new VolumeRenderer();
            
            // Initialize color legend
            this.colorLegend = new ColorLegend();
            this.colorLegend.init();
            
            // Set up color change callback
            this.colorLegend.onColorChange = (index, newColor) => {
                this.updatePointsVisualization();
            };
            
            // Generate initial seed data
            this.generateInitialSeeds();
            
            // Create seed texture for GPU
            this.createSeedTexture();
            
            // Set up initial visualization
            this.setupVisualization();
            
            // Auto-start the simulation
            this.simulationRunning = true;
            console.log('🚀 Simulation auto-started');
            
            console.log('✅ HybridVoronoiSystem initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize HybridVoronoiSystem:', error);
            throw error;
        }
    }
    
    /**
     * Generate initial seed data with random positions and default weights
     */
    generateInitialSeeds() {
        console.log(`🌱 Generating ${this.numPoints} initial seeds...`);
        
        this.seedData = [];
        
        for (let i = 0; i < this.numPoints; i++) {
            // Adjust range based on periodic boundaries
            const range = this.settings.periodicBoundaries ? 1.8 : 1.8; // Keep same range for now
            
            this.seedData.push({
                position: new THREE.Vector3(
                    (Math.random() - 0.5) * range,
                    (Math.random() - 0.5) * range,
                    (Math.random() - 0.5) * range
                ),
                weight: 0.0,  // Start with zero weight for additive JFA
                acuteCount: 0,
                id: i
            });
        }
        
        console.log('✅ Initial seeds generated');
    }
    
    /**
     * Create the seed data texture for GPU consumption
     */
    createSeedTexture() {
        console.log('🖼️ Creating seed texture for GPU...');
        
        // Calculate texture dimensions to fit all seeds
        const textureWidth = Math.ceil(Math.sqrt(this.numPoints));
        const textureHeight = textureWidth;
        this.seedTextureSize.set(textureWidth, textureHeight);
        
        // Create Float32Array to hold position (vec3) + weight (float) for each seed
        const data = new Float32Array(textureWidth * textureHeight * 4);
        
        // Create the texture
        this.seedTexture = new THREE.DataTexture(
            data, 
            textureWidth, 
            textureHeight, 
            THREE.RGBAFormat, 
            THREE.FloatType
        );
        this.seedTexture.needsUpdate = true;
        
        // Initial update
        this.updateSeedTexture();
        
        console.log(`✅ Seed texture created: ${textureWidth}x${textureHeight}`);
    }
    
    /**
     * Update the seed texture with current seed data
     */
    updateSeedTexture() {
        if (!this.seedTexture) return;
        
        const data = this.seedTexture.image.data;
        
        for (let i = 0; i < this.numPoints; i++) {
            const seed = this.seedData[i];
            const index = i * 4;
            
            // Pack position and weight into RGBA channels
            data[index] = seed.position.x;
            data[index + 1] = seed.position.y;
            data[index + 2] = seed.position.z;
            data[index + 3] = seed.weight;
        }
        
        this.seedTexture.needsUpdate = true;
    }
    
    /**
     * Set up initial visualization
     */
    setupVisualization() {
        console.log('🎨 Setting up visualization...');
        
        // Get scene reference from main app
        this.scene = window.scene || new THREE.Scene();
        
        // Create mesh group for Voronoi cells
        this.meshGroup = new THREE.Group();
        this.meshGroup.name = 'VoronoiCells';
        this.scene.add(this.meshGroup);
        
        // Create points group for seed visualization
        this.pointsGroup = new THREE.Group();
        this.pointsGroup.name = 'SeedPoints';
        this.scene.add(this.pointsGroup);
        
        // Create debug visualization group
        this.debugGroup = new THREE.Group();
        this.debugGroup.name = 'DebugVisuals';
        this.scene.add(this.debugGroup);
        
        // Initialize volume renderer (fallback for WebGL)
        this.volumeRenderer.init(this.scene);
        
        // Initialize TSL volume renderer for WebGPU
        if (this.isWebGPURenderer()) {
            this.tslVolumeRenderer = new TSLVolumeRenderer();
            this.tslVolumeRenderer.init(this.scene);
        }
        
        // Create initial point visualization
        this.updatePointsVisualization();
        
        console.log('✅ Visualization setup complete');
    }
    
    /**
     * Update the visualization of seed points
     */
    updatePointsVisualization() {
        // Clear existing points
        this.pointsGroup.clear();
        
        if (!this.settings.showPoints) return;
        
        // Create geometry for all points with configurable size
        const pointRadius = this.settings.pointSize * 0.01; // Scale factor for reasonable size
        const geometry = new THREE.SphereGeometry(pointRadius, 8, 6);
        
        this.seedData.forEach((seed, index) => {
            // Color based on acuteness if enabled
            let color = new THREE.Color(0x00ffff);
            if (this.settings.colorByAcuteness && this.colorLegend) {
                color = this.colorLegend.getColorForAcuteCount(seed.acuteCount || 0);
            }
            
            const material = new THREE.MeshBasicMaterial({ color });
            const mesh = new THREE.Mesh(geometry, material);
            
            mesh.position.copy(seed.position);
            mesh.userData = { seedIndex: index };
            
            this.pointsGroup.add(mesh);
        });
    }
    
    /**
     * Main update loop - the heart of the hybrid system
     */
    async update(deltaTime) {
        if (!this.simulationRunning) {
            return this.performanceStats;
        }
        
        const startTime = performance.now();
        
        try {
            // Only run the full pipeline if physics is enabled
            if (this.physicsEnabled) {
                // Step 1: Apply physics based on last frame's analysis
                const physicsStart = performance.now();
                if (this.isWebGPURenderer() && this.physicsCompute) {
                    // WebGPU implementation - run physics compute pass
                    await this.physicsCompute.compute(this.seedData, this.settings.physicsSettings, deltaTime);
                    await this.physicsCompute.getResults(this.seedData);
                    
                    // Get physics statistics from GPU
                    const physicsStats = await this.physicsCompute.getStatistics();
                    this.performanceStats.growingCells = physicsStats.growingCells;
                    this.performanceStats.shrinkingCells = physicsStats.shrinkingCells;
                } else {
                    // WebGL implementation - fallback to CPU physics
                    this.physicsEngine.update(this.seedData, this.settings.physicsSettings, deltaTime);
                }
                this.performanceStats.physicsTime = Math.round(performance.now() - physicsStart);
                
                // Step 2: Push updated seed data to GPU
                this.updateSeedTexture();
                
                // Step 3: Run JFA compute pass on GPU
                const jfaStart = performance.now();
                if (this.isWebGPURenderer()) {
                    // WebGPU implementation uses seed data directly
                    await this.gpuCompute.compute(this.seedData, this.numPoints);
                } else {
                    // WebGL implementation uses seed texture
                    this.gpuCompute.compute(this.seedTexture, this.seedTextureSize, this.numPoints);
                }
                this.performanceStats.jfaTime = Math.round(performance.now() - jfaStart);
                
                // Step 4: Run analysis (WebGPU compute or CPU fallback)
                const analysisStart = performance.now();
                if (this.isWebGPURenderer() && this.analysisCompute) {
                    // WebGPU implementation - run analysis compute pass
                    const jfaTexture = this.gpuCompute.getOutputTexture();
                    await this.analysisCompute.compute(jfaTexture, this.seedData);
                    await this.analysisCompute.getResults(this.seedData);
                } else {
                    // WebGL implementation - fallback to CPU analysis
                    const jfaOutput = this.gpuCompute.getOutputData();
                    this.analyzer.analyze(jfaOutput, this.seedData, this.settings.volumeResolution);
                }
                this.performanceStats.analysisTime = Math.round(performance.now() - analysisStart);
                
                // Step 5: Update visualization
                this.updateVisualization();
                
                // Step 6: Update debug visuals
                if (this.settings.showDebugVisuals) {
                    this.updateDebugVisuals();
                }
                
                // Step 7: Update color legend
                if (this.colorLegend) {
                    this.colorLegend.updateLegend(this.seedData);
                }
            } else {
                // When physics is disabled, just clear debug visuals if they're off
                if (!this.settings.showDebugVisuals && this.debugGroup) {
                    while(this.debugGroup.children.length > 0){
                        this.debugGroup.remove(this.debugGroup.children[0]);
                    }
                }
                
                // Reset performance stats when not running
                this.performanceStats.physicsTime = 0;
                this.performanceStats.jfaTime = 0;
                this.performanceStats.analysisTime = 0;
            }
            
            // Update physics statistics
            this.updatePhysicsStats();
            
        } catch (error) {
            console.error('❌ Error in update loop:', error);
        }
        
        return this.performanceStats;
    }
    
    /**
     * Update physics statistics for UI display
     */
    updatePhysicsStats() {
        if (!this.physicsEnabled) {
            this.performanceStats.growingCells = 0;
            this.performanceStats.shrinkingCells = 0;
            return;
        }
        
        const threshold = this.settings.physicsSettings.threshold;
        const mode = this.settings.physicsSettings.mode;
        
        let growing = 0;
        let shrinking = 0;
        
        this.seedData.forEach(seed => {
            const isAboveThreshold = seed.acuteCount > threshold;
            
            switch (mode) {
                case 'balanced':
                    if (isAboveThreshold) growing++;
                    else shrinking++;
                    break;
                case 'growthOnly':
                    if (isAboveThreshold) growing++;
                    break;
                case 'shrinkOnly':
                    if (isAboveThreshold) shrinking++;
                    break;
                case 'inverse':
                    if (isAboveThreshold) shrinking++;
                    else growing++;
                    break;
            }
        });
        
        this.performanceStats.growingCells = growing;
        this.performanceStats.shrinkingCells = shrinking;
    }
    
    /**
     * Update the 3D visualization
     */
    updateVisualization() {
        // Update points visualization
        this.updatePointsVisualization();
        
        // Update Voronoi cell visualization (placeholder for now)
        // This will be implemented when we have the full JFA pipeline
        this.updateCellVisualization();
    }
    
    /**
     * Update Voronoi cell visualization using volume renderer
     */
    updateCellVisualization() {
        if (!this.gpuCompute) return;
        
        if (this.isWebGPURenderer() && this.tslVolumeRenderer) {
            // WebGPU implementation - use TSL volume renderer
            const jfaTexture = this.gpuCompute.getOutputTexture();
            if (jfaTexture) {
                this.tslVolumeRenderer.updateVolume(
                    jfaTexture, 
                    this.settings.volumeResolution,
                    Math.ceil(Math.sqrt(this.settings.volumeResolution))
                );
            }
        } else if (this.volumeRenderer) {
            // WebGL implementation - use traditional volume renderer
            const renderTarget = this.gpuCompute.getCurrentRenderTarget();
            if (renderTarget) {
                this.volumeRenderer.updateVolume(
                    renderTarget, 
                    this.settings.volumeResolution,
                    Math.ceil(Math.sqrt(this.settings.volumeResolution))
                );
            }
        }
    }
    
    /**
     * Regenerate the Voronoi diagram with new parameters
     */
    regenerate(numPoints, resolution) {
        console.log(`🔄 Regenerating with ${numPoints} points at ${resolution}³ resolution...`);
        
        this.numPoints = numPoints;
        this.settings.volumeResolution = resolution;
        
        // Generate new seeds
        this.generateInitialSeeds();
        
        // Update texture
        this.createSeedTexture();
        
        // Update GPU compute settings
        this.gpuCompute.setResolution(resolution);
        
        // Start simulation
        this.simulationRunning = true;
        
        console.log('✅ Regeneration complete');
    }
    
    /**
     * Start physics simulation
     */
    startPhysics(settings) {
        console.log('▶️ Starting physics simulation...');
        
        Object.assign(this.settings.physicsSettings, settings);
        this.physicsEnabled = true;
        this.simulationRunning = true;
        
        console.log('✅ Physics simulation started');
    }
    
    /**
     * Stop physics simulation
     */
    stopPhysics() {
        console.log('⏸️ Stopping physics simulation...');
        
        this.physicsEnabled = false;
        
        console.log('✅ Physics simulation stopped');
    }
    
    /**
     * Enable/disable physics
     */
    setPhysicsEnabled(enabled) {
        this.physicsEnabled = enabled;
        console.log(`⚡ Physics ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * Show/hide edges
     */
    setEdgesVisible(visible) {
        this.settings.showEdges = visible;
        if (this.volumeRenderer) {
            this.volumeRenderer.setEdgesVisible(visible);
        }
        console.log(`🔲 Edges ${visible ? 'visible' : 'hidden'}`);
    }
    
    /**
     * Show/hide seed points
     */
    setPointsVisible(visible) {
        this.settings.showPoints = visible;
        this.updatePointsVisualization();
        console.log(`⚫ Points ${visible ? 'visible' : 'hidden'}`);
    }
    
    /**
     * Enable/disable acuteness-based coloring
     */
    setColorByAcuteness(enabled) {
        this.settings.colorByAcuteness = enabled;
        this.updatePointsVisualization();
        console.log(`🎨 Color by acuteness ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * Set transparency
     */
    setTransparency(transparency) {
        this.settings.transparency = transparency;
        if (this.volumeRenderer) {
            this.volumeRenderer.setTransparency(transparency);
        }
        console.log(`🎨 Transparency set to ${transparency}`);
    }
    
    /**
     * Enable/disable periodic boundaries
     */
    setPeriodicBoundaries(enabled) {
        this.settings.periodicBoundaries = enabled;
        console.log(`🔄 Periodic boundaries ${enabled ? 'enabled' : 'disabled'}`);
        
        // Note: This will take effect on next regeneration
        console.log('💡 Regenerate to apply periodic boundary changes');
    }
    
    /**
     * Set point size for visualization
     */
    setPointSize(size) {
        this.settings.pointSize = size;
        console.log(`🔍 Point size set to: ${size}`);
        
        // Update point visualization
        this.updatePointsVisualization();
    }
    
    /**
     * Toggle physics engine on/off
     */
    setPhysicsEnabled(enabled) {
        this.physicsEnabled = enabled;
        console.log(`🔍 Physics enabled set to: ${enabled}`);
        
        // If disabling physics, clear debug visuals if they're off
        if (!enabled && !this.settings.showDebugVisuals && this.debugGroup) {
            while(this.debugGroup.children.length > 0){
                this.debugGroup.remove(this.debugGroup.children[0]);
            }
        }
    }
    
    /**
     * Toggle debug visuals display
     */
    setShowDebugVisuals(show) {
        this.settings.showDebugVisuals = show;
        console.log(`🔍 Debug visuals set to: ${show}`);
        
        // If turning off, clear debug visuals immediately
        if (!show && this.debugGroup) {
            while(this.debugGroup.children.length > 0){
                this.debugGroup.remove(this.debugGroup.children[0]);
            }
        }
    }
    
    /**
     * Update debug visuals showing centroids and seed-to-centroid arrows
     * This is critical for understanding if the analyzer is working correctly
     */
    updateDebugVisuals() {
        if (!this.debugGroup) return;
        
        // Clear previous debug visuals
        while(this.debugGroup.children.length > 0){
            this.debugGroup.remove(this.debugGroup.children[0]);
        }
        
        // Only add visuals if the setting is enabled
        if (!this.settings.showDebugVisuals) return;
        
        for (const seed of this.seedData) {
            if (!seed.centroid) continue;
            
            // 1. Draw a small sphere at the centroid's location (green)
            const centroidGeom = new THREE.SphereGeometry(0.02, 8, 8);
            const centroidMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // Green
            const centroidMesh = new THREE.Mesh(centroidGeom, centroidMat);
            centroidMesh.position.copy(seed.centroid);
            this.debugGroup.add(centroidMesh);
            
            // 2. Draw an arrow from the seed to the centroid (yellow)
            const dir = new THREE.Vector3().subVectors(seed.centroid, seed.position);
            const length = dir.length();
            
            // Only draw arrow if there's a meaningful distance
            if (length > 0.01) {
                const arrowHelper = new THREE.ArrowHelper(
                    dir.clone().normalize(), 
                    seed.position, 
                    length, 
                    0xffff00, // Yellow
                    length * 0.2, // Head length
                    length * 0.1  // Head width
                );
                this.debugGroup.add(arrowHelper);
            }
        }
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        console.log('🧹 Disposing HybridVoronoiSystem...');
        
        if (this.gpuCompute) {
            this.gpuCompute.dispose();
        }
        
        if (this.seedTexture) {
            this.seedTexture.dispose();
        }
        
        if (this.volumeRenderer) {
            this.volumeRenderer.dispose();
        }
        
        if (this.colorLegend) {
            this.colorLegend.dispose();
        }
        
        if (this.meshGroup) {
            this.scene.remove(this.meshGroup);
        }
        
        if (this.pointsGroup) {
            this.scene.remove(this.pointsGroup);
        }
        
        if (this.debugGroup) {
            this.scene.remove(this.debugGroup);
        }
        
        console.log('✅ HybridVoronoiSystem disposed');
    }
}

// Make scene accessible globally for visualization setup
if (typeof window !== 'undefined') {
    window.HybridVoronoiSystem = HybridVoronoiSystem;
} 