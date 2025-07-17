import * as THREE from 'three';
import { 
    texture3D, 
    mix, 
    smoothstep, 
    abs, 
    max, 
    min, 
    step, 
    fract, 
    dot, 
    normalize, 
    vec3, 
    vec4, 
    float,
    uniform,
    varying,
    varyingProperty,
    Fn,
    Loop,
    Break,
    Continue,
    If
} from 'three/tsl';

/**
 * TSLVolumeRenderer - Modern TSL-based volume renderer
 * 
 * This replaces the traditional GLSL-based VolumeRenderer with a modern
 * TSL (Three.js Shader Language) implementation using NodeMaterial.
 * The renderer uses JFA texture data to create 3D Voronoi visualizations
 * with proper edge detection and cell coloring.
 */
export class TSLVolumeRenderer {
    constructor() {
        this.volumeBox = null;
        this.volumeMaterial = null;
        this.scene = null;
        
        // TSL uniforms
        this.uAtlas = uniform(null);
        this.uStepOpacity = uniform(0.02);
        this.uEdgeSmoothness = uniform(2.0);
        this.uBoxMin = uniform(vec3(-1, -1, -1));
        this.uBoxMax = uniform(vec3(1, 1, 1));
        this.uVolumeSize = uniform(64);
        this.uSlicesPerRow = uniform(8);
        this.uColorMode = uniform(0.0);
        this.uCellColor = uniform(vec3(0.5, 0.5, 0.5));
        this.uTransparency = uniform(0.7);
        this.uFaceColor = uniform(vec3(0.0, 1.0, 1.0));
        this.uFaceTransparency = uniform(0.8);
        this.uEdgeColor = uniform(vec3(0.0, 1.0, 1.0));
        this.uEdgeTransparency = uniform(1.0);
        this.uCellTransparency = uniform(0.3);
        
        // Rendering settings
        this.transparency = 0.7;
        this.showEdges = true;
        this.edgeColor = new THREE.Color(0x00ffff);
        this.faceColor = new THREE.Color(0x00ffff);
        
        console.log('📦 TSLVolumeRenderer constructor completed');
    }
    
    /**
     * Initialize the TSL volume renderer
     */
    init(scene) {
        this.scene = scene;
        this.createTSLMaterial();
        this.createVolumeBox();
        
        console.log('✅ TSLVolumeRenderer initialized');
    }
    
    /**
     * Create the TSL-based volume material
     */
    createTSLMaterial() {
        // Create the volume sampling function
        const sampleVolume = Fn(([uvw]) => {
            const volumeSize = this.uVolumeSize;
            const slicesPerRow = this.uSlicesPerRow;
            
            // Convert 3D coordinate to 2D atlas coordinate
            const z = uvw.z.mul(volumeSize.sub(1));
            const zFloor = z.floor();
            const zFract = z.sub(zFloor);
            
            // Calculate slice positions in atlas
            const sliceY = zFloor.div(slicesPerRow).floor();
            const sliceX = zFloor.sub(sliceY.mul(slicesPerRow));
            
            // Calculate UV coordinates for both slices
            const sliceSize = float(1.0).div(slicesPerRow);
            const pixelSize = sliceSize.div(volumeSize);
            
            const uv1 = vec3(
                sliceX.mul(sliceSize).add(uvw.x.mul(pixelSize)),
                sliceY.mul(sliceSize).add(uvw.y.mul(pixelSize)),
                0
            );
            
            const uv2 = vec3(
                sliceX.add(1).mul(sliceSize).add(uvw.x.mul(pixelSize)),
                sliceY.mul(sliceSize).add(uvw.y.mul(pixelSize)),
                0
            );
            
            // Sample both slices and interpolate
            const sample1 = texture3D(this.uAtlas, uv1);
            const sample2 = texture3D(this.uAtlas, uv2);
            
            return mix(sample1, sample2, zFract);
        });
        
        // HSV to RGB conversion function
        const hsv2rgb = Fn(([hsv]) => {
            const h = hsv.x.mul(6.0);
            const s = hsv.y;
            const v = hsv.z;
            
            const c = v.mul(s);
            const x = c.mul(float(1.0).sub(abs(h.mod(2.0).sub(1.0))));
            const m = v.sub(c);
            
            const hFloor = h.floor();
            
            return vec3().select(
                hFloor.equal(0), vec3(c, x, 0),
                hFloor.equal(1), vec3(x, c, 0),
                hFloor.equal(2), vec3(0, c, x),
                hFloor.equal(3), vec3(0, x, c),
                hFloor.equal(4), vec3(x, 0, c),
                vec3(c, 0, x)
            ).add(m);
        });
        
        // Ray-box intersection function
        const rayBoxIntersection = Fn(([rayOrigin, rayDir, boxMin, boxMax]) => {
            const invDir = float(1.0).div(rayDir);
            const t1 = boxMin.sub(rayOrigin).mul(invDir);
            const t2 = boxMax.sub(rayOrigin).mul(invDir);
            
            const tMin = min(t1, t2);
            const tMax = max(t1, t2);
            
            const tNear = max(max(tMin.x, tMin.y), tMin.z);
            const tFar = min(min(tMax.x, tMax.y), tMax.z);
            
            return vec3(tNear, tFar, step(tNear, tFar));
        });
        
        // Main fragment shader function
        const fragmentShader = Fn(() => {
            const vWorldPosition = varyingProperty('vec3', 'worldPosition');
            const vViewPosition = varyingProperty('vec3', 'viewPosition');
            
            // Calculate ray direction
            const rayDir = normalize(vWorldPosition.sub(vViewPosition));
            const rayOrigin = vViewPosition;
            
            // Ray-box intersection
            const intersection = rayBoxIntersection(rayOrigin, rayDir, this.uBoxMin, this.uBoxMax);
            const tNear = intersection.x;
            const tFar = intersection.y;
            const hit = intersection.z;
            
            // Early exit if no intersection
            If(hit.equal(0).or(tFar.lessThan(tNear)), () => {
                return vec4(0, 0, 0, 0);
            });
            
            // Volume ray marching
            const stepSize = float(0.01);
            const maxSteps = 200;
            let currentPos = rayOrigin.add(rayDir.mul(max(tNear, 0.0)));
            let accumulatedColor = vec4(0, 0, 0, 0);
            
            const pixelSize = vec3(1.0).div(this.uVolumeSize);
            
            Loop(maxSteps, ({ i }) => {
                // Convert to UVW coordinates
                const uvw = currentPos.sub(this.uBoxMin).div(this.uBoxMax.sub(this.uBoxMin));
                
                // Check bounds
                If(uvw.x.lessThan(0).or(uvw.x.greaterThan(1))
                   .or(uvw.y.lessThan(0).or(uvw.y.greaterThan(1)))
                   .or(uvw.z.lessThan(0).or(uvw.z.greaterThan(1))), () => {
                    Break();
                });
                
                // Sample volume
                const data = sampleVolume(uvw);
                
                // Skip empty voxels
                If(data.w.lessThan(0.5), () => {
                    currentPos = currentPos.add(rayDir.mul(stepSize));
                    Continue();
                });
                
                // Sample neighbors for edge detection
                const neighborX = sampleVolume(uvw.add(vec3(pixelSize.x, 0, 0)));
                const neighborY = sampleVolume(uvw.add(vec3(0, pixelSize.y, 0)));
                const neighborZ = sampleVolume(uvw.add(vec3(0, 0, pixelSize.z)));
                
                // Detect faces (boundaries between cells)
                let faceDiff = float(0);
                If(neighborX.w.greaterThan(0.5), () => {
                    faceDiff = max(faceDiff, abs(data.w.sub(neighborX.w)));
                });
                If(neighborY.w.greaterThan(0.5), () => {
                    faceDiff = max(faceDiff, abs(data.w.sub(neighborY.w)));
                });
                If(neighborZ.w.greaterThan(0.5), () => {
                    faceDiff = max(faceDiff, abs(data.w.sub(neighborZ.w)));
                });
                
                // Count unique cell IDs for edge detection
                let uniqueCount = float(1); // Current cell
                If(neighborX.w.greaterThan(0.5).and(abs(neighborX.w.sub(data.w)).greaterThan(0.01)), () => {
                    uniqueCount = uniqueCount.add(1);
                });
                If(neighborY.w.greaterThan(0.5).and(abs(neighborY.w.sub(data.w)).greaterThan(0.01))
                   .and(abs(neighborY.w.sub(neighborX.w)).greaterThan(0.01)), () => {
                    uniqueCount = uniqueCount.add(1);
                });
                If(neighborZ.w.greaterThan(0.5).and(abs(neighborZ.w.sub(data.w)).greaterThan(0.01))
                   .and(abs(neighborZ.w.sub(neighborX.w)).greaterThan(0.01))
                   .and(abs(neighborZ.w.sub(neighborY.w)).greaterThan(0.01)), () => {
                    uniqueCount = uniqueCount.add(1);
                });
                
                // Calculate face and edge factors
                const faceFactor = smoothstep(0, float(0.01).mul(this.uEdgeSmoothness), faceDiff);
                const edgeFactor = smoothstep(2.5, 3.5, uniqueCount);
                
                // Calculate cell color
                let cellColor = vec3();
                If(this.uColorMode.lessThan(0.5), () => {
                    // Rainbow colors based on cell ID
                    const hue = fract(data.w.mul(0.618033988749895));
                    cellColor = hsv2rgb(vec3(hue, 0.7, 0.8));
                }, () => {
                    cellColor = this.uCellColor;
                });
                
                // Three-way mix: cell -> face -> edge
                let finalColor = cellColor;
                let transparencyFactor = this.uCellTransparency;
                
                If(edgeFactor.greaterThan(0.01), () => {
                    // Edge takes priority
                    finalColor = mix(finalColor, this.uEdgeColor, edgeFactor);
                    transparencyFactor = mix(transparencyFactor, this.uEdgeTransparency, edgeFactor);
                }, () => {
                    If(faceFactor.greaterThan(0.01), () => {
                        // Face
                        finalColor = mix(finalColor, this.uFaceColor, faceFactor);
                        transparencyFactor = mix(transparencyFactor, this.uFaceTransparency, faceFactor);
                    });
                });
                
                // Calculate opacity
                const baseOpacity = step(0.01, faceFactor.add(edgeFactor)).select(
                    this.uStepOpacity.mul(5.0),
                    this.uStepOpacity
                );
                
                // Front-to-back compositing
                let alpha = baseOpacity.mul(this.uTransparency).mul(transparencyFactor);
                If(edgeFactor.greaterThan(0.01), () => {
                    alpha = min(alpha.mul(5.0), 1.0); // Make edges more opaque
                });
                
                const a = alpha.mul(float(1.0).sub(accumulatedColor.w));
                accumulatedColor = vec4(
                    accumulatedColor.xyz.add(finalColor.mul(a)),
                    accumulatedColor.w.add(a)
                );
                
                // Early termination
                If(accumulatedColor.w.greaterThan(0.95), () => {
                    Break();
                });
                
                currentPos = currentPos.add(rayDir.mul(stepSize));
            });
            
            return vec4(
                accumulatedColor.xyz,
                min(accumulatedColor.w, 1.0).mul(this.uTransparency)
            );
        });
        
        // Create NodeMaterial
        this.volumeMaterial = new THREE.NodeMaterial();
        this.volumeMaterial.transparent = true;
        this.volumeMaterial.side = THREE.BackSide;
        this.volumeMaterial.depthWrite = false;
        
        // Set up vertex shader to pass world position
        this.volumeMaterial.vertexNode = Fn(() => {
            const worldPosition = varyingProperty('vec3', 'worldPosition');
            const viewPosition = varyingProperty('vec3', 'viewPosition');
            
            worldPosition.assign(vec3(0, 0, 0)); // Will be set by Three.js
            viewPosition.assign(vec3(0, 0, 0)); // Will be set by Three.js
        })();
        
        // Set fragment shader
        this.volumeMaterial.fragmentNode = fragmentShader();
        
        console.log('📦 TSL volume material created');
    }
    
    /**
     * Create the volume box geometry
     */
    createVolumeBox() {
        if (this.volumeBox) {
            this.scene.remove(this.volumeBox);
            this.volumeBox.geometry.dispose();
            this.volumeBox.material.dispose();
        }
        
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        this.volumeBox = new THREE.Mesh(geometry, this.volumeMaterial);
        this.scene.add(this.volumeBox);
        
        console.log('📦 TSL volume box created');
    }
    
    /**
     * Update the volume with new JFA data
     */
    updateVolume(jfaTexture, volumeSize, slicesPerRow) {
        if (!this.volumeMaterial || !jfaTexture) return;
        
        // Update TSL uniforms
        this.uAtlas.value = jfaTexture;
        this.uVolumeSize.value = volumeSize;
        this.uSlicesPerRow.value = slicesPerRow;
        
        console.log(`📦 TSL volume updated with ${volumeSize}³ resolution`);
    }
    
    /**
     * Set transparency
     */
    setTransparency(transparency) {
        this.transparency = transparency;
        this.uTransparency.value = transparency;
        
        console.log(`📦 TSL transparency set to ${transparency}`);
    }
    
    /**
     * Set edge color
     */
    setEdgeColor(color) {
        this.edgeColor.copy(color);
        this.uEdgeColor.value = new THREE.Vector3(color.r, color.g, color.b);
        
        console.log(`📦 TSL edge color updated`);
    }
    
    /**
     * Set face color
     */
    setFaceColor(color) {
        this.faceColor.copy(color);
        this.uFaceColor.value = new THREE.Vector3(color.r, color.g, color.b);
        
        console.log(`📦 TSL face color updated`);
    }
    
    /**
     * Set color mode
     */
    setColorMode(mode) {
        this.uColorMode.value = mode;
        
        console.log(`📦 TSL color mode set to ${mode}`);
    }
    
    /**
     * Set cell color (for single color mode)
     */
    setCellColor(color) {
        this.uCellColor.value = new THREE.Vector3(color.r, color.g, color.b);
        
        console.log(`📦 TSL cell color updated`);
    }
    
    /**
     * Set edge smoothness
     */
    setEdgeSmoothness(smoothness) {
        this.uEdgeSmoothness.value = smoothness;
        
        console.log(`📦 TSL edge smoothness set to ${smoothness}`);
    }
    
    /**
     * Set step opacity
     */
    setStepOpacity(opacity) {
        this.uStepOpacity.value = opacity;
        
        console.log(`📦 TSL step opacity set to ${opacity}`);
    }
    
    /**
     * Get the volume mesh for external manipulation
     */
    getVolumeMesh() {
        return this.volumeBox;
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        console.log('🧹 Disposing TSLVolumeRenderer...');
        
        if (this.volumeBox) {
            this.scene.remove(this.volumeBox);
            this.volumeBox.geometry.dispose();
            this.volumeBox.material.dispose();
        }
        
        console.log('✅ TSLVolumeRenderer disposed');
    }
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.TSLVolumeRenderer = TSLVolumeRenderer;
} 