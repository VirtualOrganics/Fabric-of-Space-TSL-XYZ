import * as THREE from 'three';

/**
 * VolumeRenderer - Renders JFA output as 3D Voronoi cells
 * 
 * This class creates a volume rendering system that displays the JFA output
 * as actual 3D Voronoi cells with proper edges and faces
 */
export class VolumeRenderer {
    constructor() {
        this.volumeBox = null;
        this.volumeMaterial = null;
        this.scene = null;
        
        // Rendering settings
        this.transparency = 0.7;
        this.showEdges = true;
        this.edgeColor = new THREE.Color(0x00ffff);
        this.faceColor = new THREE.Color(0x00ffff);
        
        console.log('📦 VolumeRenderer constructor completed');
    }
    
    /**
     * Initialize the volume renderer
     */
    init(scene) {
        this.scene = scene;
        this.createVolumeMaterial();
        this.createVolumeBox();
        
        console.log('✅ VolumeRenderer initialized');
    }
    
    /**
     * Create the volume rendering material
     */
    createVolumeMaterial() {
        this.volumeMaterial = new THREE.ShaderMaterial({
            vertexShader: this.getVertexShader(),
            fragmentShader: this.getFragmentShader(),
            uniforms: {
                uAtlas: { value: null },
                uStepOpacity: { value: 0.02 },
                uEdgeSmoothness: { value: 2.0 },
                uBoxMin: { value: new THREE.Vector3(-1, -1, -1) },
                uBoxMax: { value: new THREE.Vector3(1, 1, 1) },
                uVolumeSize: { value: 64 },
                uSlicesPerRow: { value: 8 },
                uColorMode: { value: 0.0 }, // 0 = random hue, 1 = single color
                uCellColor: { value: new THREE.Color(0x888888) },
                uTransparency: { value: this.transparency },
                uTransparencyMode: { value: 0.0 }, // 0 = foggy, 1 = glass
                uFaceColor: { value: this.faceColor },
                uFaceTransparency: { value: 0.8 },
                uEdgeColor: { value: this.edgeColor },
                uEdgeTransparency: { value: 1.0 },
                uCellTransparency: { value: 0.3 }
            },
            transparent: true,
            side: THREE.BackSide
        });
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
        
        console.log('📦 Volume box created');
    }
    
    /**
     * Update the volume with new JFA data
     */
    updateVolume(jfaRenderTarget, volumeSize, slicesPerRow) {
        if (!this.volumeMaterial || !jfaRenderTarget) return;
        
        // Update uniforms
        this.volumeMaterial.uniforms.uAtlas.value = jfaRenderTarget.texture;
        this.volumeMaterial.uniforms.uVolumeSize.value = volumeSize;
        this.volumeMaterial.uniforms.uSlicesPerRow.value = slicesPerRow;
        
        console.log(`📦 Volume updated with ${volumeSize}³ resolution`);
    }
    
    /**
     * Set transparency
     */
    setTransparency(transparency) {
        this.transparency = transparency;
        if (this.volumeMaterial) {
            this.volumeMaterial.uniforms.uTransparency.value = transparency;
        }
    }
    
    /**
     * Set edge visibility
     */
    setEdgesVisible(visible) {
        this.showEdges = visible;
        if (this.volumeMaterial) {
            this.volumeMaterial.uniforms.uEdgeTransparency.value = visible ? 1.0 : 0.0;
        }
    }
    
    /**
     * Get vertex shader
     */
    getVertexShader() {
        return `
            varying vec3 vPosition;
            varying vec3 vDirection;
            
            void main() {
                vPosition = position;
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vDirection = normalize(worldPos.xyz - cameraPosition);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
    }
    
    /**
     * Get fragment shader
     */
    getFragmentShader() {
        return `
            uniform sampler2D uAtlas;
            uniform float uStepOpacity;
            uniform float uEdgeSmoothness;
            uniform vec3 uBoxMin;
            uniform vec3 uBoxMax;
            uniform float uVolumeSize;
            uniform float uSlicesPerRow;
            uniform float uColorMode;
            uniform vec3 uCellColor;
            uniform float uTransparency;
            uniform float uTransparencyMode;
            uniform vec3 uFaceColor;
            uniform float uFaceTransparency;
            uniform vec3 uEdgeColor;
            uniform float uEdgeTransparency;
            uniform float uCellTransparency;
            
            varying vec3 vPosition;
            varying vec3 vDirection;
            
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
            
            vec4 sampleVolume(vec3 pos) {
                if (any(lessThan(pos, vec3(0.0))) || any(greaterThan(pos, vec3(1.0)))) {
                    return vec4(0.0);
                }
                return texture2D(uAtlas, volumeToAtlas(pos));
            }
            
            vec2 intersectBox(vec3 origin, vec3 direction, vec3 boxMin, vec3 boxMax) {
                vec3 invDir = 1.0 / direction;
                vec3 tMin = (boxMin - origin) * invDir;
                vec3 tMax = (boxMax - origin) * invDir;
                vec3 t1 = min(tMin, tMax);
                vec3 t2 = max(tMin, tMax);
                float tNear = max(max(t1.x, t1.y), t1.z);
                float tFar = min(min(t2.x, t2.y), t2.z);
                return vec2(tNear, tFar);
            }
            
            vec3 hsv2rgb(vec3 c) {
                vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
            }
            
            void main() {
                vec3 rayOrigin = cameraPosition;
                vec3 rayDir = normalize(vDirection);
                vec2 t = intersectBox(rayOrigin, rayDir, uBoxMin, uBoxMax);
                
                if (t.x > t.y || t.y < 0.0) discard;
                
                float stepSize = 0.01;
                int maxSteps = 200;
                vec3 currentPos = rayOrigin + rayDir * max(t.x, 0.0);
                vec4 accumulatedColor = vec4(0.0);
                
                vec3 pixelSize = 1.0 / vec3(uVolumeSize);
                
                for (int i = 0; i < maxSteps; i++) {
                    vec3 uvw = (currentPos - uBoxMin) / (uBoxMax - uBoxMin);
                    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) break;
                    
                    vec4 data = sampleVolume(uvw);
                    
                    if (data.w < 0.5) {
                        currentPos += rayDir * stepSize;
                        continue;
                    }
                    
                    // Sample neighbors for face and edge detection
                    vec4 neighborX = sampleVolume(uvw + vec3(pixelSize.x, 0.0, 0.0));
                    vec4 neighborY = sampleVolume(uvw + vec3(0.0, pixelSize.y, 0.0));
                    vec4 neighborZ = sampleVolume(uvw + vec3(0.0, 0.0, pixelSize.z));
                    
                    // Detect faces (boundaries between two cells)
                    float faceDiff = 0.0;
                    if (neighborX.w > 0.5) faceDiff = max(faceDiff, abs(data.w - neighborX.w));
                    if (neighborY.w > 0.5) faceDiff = max(faceDiff, abs(data.w - neighborY.w));
                    if (neighborZ.w > 0.5) faceDiff = max(faceDiff, abs(data.w - neighborZ.w));
                    
                    // Count unique cell IDs to detect edges (where 3+ cells meet)
                    float uniqueCount = 1.0; // Current cell
                    if (neighborX.w > 0.5 && abs(neighborX.w - data.w) > 0.01) uniqueCount += 1.0;
                    if (neighborY.w > 0.5 && abs(neighborY.w - data.w) > 0.01 && abs(neighborY.w - neighborX.w) > 0.01) uniqueCount += 1.0;
                    if (neighborZ.w > 0.5 && abs(neighborZ.w - data.w) > 0.01 && abs(neighborZ.w - neighborX.w) > 0.01 && abs(neighborZ.w - neighborY.w) > 0.01) uniqueCount += 1.0;
                    
                    // Use smoothstep to create smooth transitions
                    float faceFactor = smoothstep(0.0, 0.01 * uEdgeSmoothness, faceDiff);
                    float edgeFactor = smoothstep(2.5, 3.5, uniqueCount); // Edges where 3+ cells meet
                    
                    vec3 cellColor;
                    if (uColorMode < 0.5) {
                        // Use rainbow colors based on cell ID for now
                        // This will be updated to use legend colors in the future
                        float hue = fract(data.w * 0.618033988749895);
                        cellColor = hsv2rgb(vec3(hue, 0.7, 0.8));
                    } else {
                        cellColor = uCellColor;
                    }
                    
                    // Three-way mix: cell -> face -> edge
                    vec3 finalColor = cellColor;
                    float transparencyFactor = uCellTransparency;
                    
                    if (edgeFactor > 0.01) {
                        // Edge takes priority
                        finalColor = mix(finalColor, uEdgeColor, edgeFactor);
                        transparencyFactor = mix(transparencyFactor, uEdgeTransparency, edgeFactor);
                    } else if (faceFactor > 0.01) {
                        // Face
                        finalColor = mix(finalColor, uFaceColor, faceFactor);
                        transparencyFactor = mix(transparencyFactor, uFaceTransparency, faceFactor);
                    }
                    
                    float opacity = (faceFactor > 0.01 || edgeFactor > 0.01) ? uStepOpacity * 5.0 : uStepOpacity;
                    
                    // Front-to-back compositing
                    float alpha = opacity * uTransparency * transparencyFactor;
                    if (edgeFactor > 0.01) alpha = min(alpha * 5.0, 1.0); // Make edges more opaque
                    
                    float a = alpha * (1.0 - accumulatedColor.a);
                    accumulatedColor.rgb += finalColor * a;
                    accumulatedColor.a += a;
                    
                    if (accumulatedColor.a > 0.95) break;
                    
                    currentPos += rayDir * stepSize;
                }
                
                gl_FragColor = vec4(accumulatedColor.rgb, min(accumulatedColor.a, 1.0) * uTransparency);
            }
        `;
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        console.log('🧹 Disposing VolumeRenderer...');
        
        if (this.volumeBox) {
            this.scene.remove(this.volumeBox);
            this.volumeBox.geometry.dispose();
            this.volumeBox.material.dispose();
        }
        
        console.log('✅ VolumeRenderer disposed');
    }
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.VolumeRenderer = VolumeRenderer;
} 