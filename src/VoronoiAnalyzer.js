import * as THREE from 'three';

/**
 * VoronoiAnalyzer - Optimized CPU module for analyzing JFA output
 * 
 * This class implements the hybrid CPU/GPU pipeline with:
 * 1. Robust centroid calculation using voxel summation method
 * 2. Refined acute angle calculation using vertex-finding method for geometric sharpness
 * 3. Separation of concerns: centroids for physics, vertices for angles
 */
export class VoronoiAnalyzer {
    constructor() {
        this.vertices = [];
        this.analysisCache = new Map();
        this.lastAnalysisTime = 0;
        this.dimensions = { width: 0, height: 0, depth: 0 };
        this.seedData = [];
        
        // Temporary vectors for calculations (reused for performance)
        this.tempVec1 = new THREE.Vector3();
        this.tempVec2 = new THREE.Vector3();
        this.tempVec3 = new THREE.Vector3();
        
        console.log('🔍 VoronoiAnalyzer (Optimized) constructor completed');
    }
    
    /**
     * Main analysis function - processes JFA output and updates seed data
     * Uses the hybrid approach: voxel summation for centroids, vertex-finding for angles
     */
    analyze(jfaBuffer, seedData, volumeSize) {
        const startTime = performance.now();
        
        if (!jfaBuffer || !seedData) {
            console.warn('⚠️ Invalid input data provided');
            return;
        }
        
        // Store references for internal methods
        this.seedData = seedData;
        this.dimensions = { width: volumeSize, height: volumeSize, depth: volumeSize };
        
        console.log(`🔍 Starting optimized analysis of ${volumeSize}³ volume...`);
        
        try {
            // Clear previous data
            for (const seed of this.seedData) {
                seed.acuteCount = 0;
                // Initialize centroid calculation data
                seed.voxelCount = 0;
                seed.positionSum = new THREE.Vector3(0, 0, 0);
                seed.centroid = new THREE.Vector3();
            }

            // Run the two main analysis steps
            this._calculateVoxelSummation(jfaBuffer); // New robust centroid method
            this._calculateAnglesFromJunctions(jfaBuffer); // Refined vertex-finding method for angles
            
            this.lastAnalysisTime = Math.round(performance.now() - startTime);
            
            console.log(`✅ Optimized analysis completed in ${this.lastAnalysisTime}ms`);
            console.log(`📊 Found ${this.vertices.length} Voronoi vertices`);
            
            // Log statistics
            this.logAnalysisStatistics();
            
        } catch (error) {
            console.error('❌ Error in optimized Voronoi analysis:', error);
            this.lastAnalysisTime = 0;
        }
    }
    
    /**
     * Phase 1: Robust Centroid Calculation using Voxel Summation
     * This is the superior method that avoids boundary issues
     */
    _calculateVoxelSummation(buffer) {
        console.log('🔍 Calculating centroids using voxel summation...');
        
        const { width, height, depth } = this.dimensions;
        const totalVoxels = width * height * depth;
        
        // Single, cache-friendly loop over all voxels
        for (let i = 0; i < totalVoxels; i++) {
            const index = i * 4;
            
            // Get cell ID from alpha channel (normalized 0-1, convert to seed index)
            const cellIDNormalized = buffer[index + 3];
            
            // Skip voxels with no seed assigned (cellIDNormalized = 0)
            if (cellIDNormalized < 0.001) continue;
            
            // Convert normalized ID back to seed index: (i + 1) / numPoints -> i
            const cellID = Math.round(cellIDNormalized * this.seedData.length) - 1;
            
            if (cellID >= 0 && cellID < this.seedData.length) {
                const seed = this.seedData[cellID];
                
                // Get the (x,y,z) coordinate of this voxel
                const x = i % width;
                const y = Math.floor(i / width) % height;
                const z = Math.floor(i / (width * height));
                
                // Add to the running sum for this cell
                seed.positionSum.x += x;
                seed.positionSum.y += y;
                seed.positionSum.z += z;
                seed.voxelCount++;
            }
        }
        
        // Finalize the centroid calculation for each cell
        let validCentroids = 0;
        for (const seed of this.seedData) {
            if (seed.voxelCount > 0) {
                seed.centroid.copy(seed.positionSum).divideScalar(seed.voxelCount);
                
                // CRUCIAL: Convert from texture space [0, dim] to world space [-1, 1]
                seed.centroid.x = (seed.centroid.x / width) * 2 - 1;
                seed.centroid.y = (seed.centroid.y / height) * 2 - 1;
                seed.centroid.z = (seed.centroid.z / depth) * 2 - 1;
                
                validCentroids++;
            } else {
                // If a cell has no voxels, its centroid is its own position
                seed.centroid.copy(seed.position);
                console.warn(`⚠️ Cell ${this.seedData.indexOf(seed)} has no voxels, using seed position as centroid`);
            }
        }
        
        console.log(`✅ Calculated ${validCentroids} valid centroids`);
    }
    
    /**
     * Phase 2: Refined Acute Angle Calculation using Vertex-Finding
     * Uses the vertex-finding method only for calculating angles (geometric sharpness)
     */
    _calculateAnglesFromJunctions(buffer) {
        console.log('📐 Calculating angles from junctions...');
        
        // Find junctions using the existing robust method
        const vertices = this._findJunctions(buffer);
        this.vertices = vertices; // Store for debugging
        
        // Use the superior "seed-to-vertex" angle calculation
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        
        let totalAngles = 0;
        let acuteAngles = 0;
        
        for (const vertex of vertices) {
            const ids = vertex.cellIDs;
            if (ids.length < 2) continue;
            
            // Check all pairs of cells meeting at this vertex
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const idA = ids[i];
                    const idB = ids[j];
                    
                    if (idA >= 0 && idA < this.seedData.length && 
                        idB >= 0 && idB < this.seedData.length) {
                        
                        const seedA = this.seedData[idA];
                        const seedB = this.seedData[idB];
                        
                        // Calculate vectors from vertex to each seed
                        vA.subVectors(seedA.position, vertex.position).normalize();
                        vB.subVectors(seedB.position, vertex.position).normalize();
                        
                        // Calculate angle between vectors
                        const dotProduct = vA.dot(vB);
                        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dotProduct)));
                        
                        totalAngles++;
                        
                        // Count acute angles (< 90 degrees)
                        if (angle < Math.PI / 2.0) {
                            seedA.acuteCount++;
                            seedB.acuteCount++;
                            acuteAngles++;
                        }
                    }
                }
            }
        }
        
        console.log(`✅ Processed ${totalAngles} angles, ${acuteAngles} acute (${Math.round(acuteAngles/totalAngles*100)}%)`);
    }
    
    /**
     * Find junctions (Voronoi vertices) where 4+ cells meet
     * This method remains the same as it's already robust
     */
    _findJunctions(buffer) {
        const { width, height, depth } = this.dimensions;
        const vertices = [];
        
                 // Helper function to get cell ID from 3D coordinates
         const getCellID = (x, y, z) => {
             if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) {
                 return -1;
             }
             
             const index = (z * width * height + y * width + x) * 4;
             const cellIDNormalized = buffer[index + 3];
             
             // Return -1 for voxels with no seed assigned
             if (cellIDNormalized < 0.001) return -1;
             
             // Convert normalized ID back to seed index
             return Math.round(cellIDNormalized * this.seedData.length) - 1;
         };
        
        // Scan for junctions by checking 2x2x2 cubes in 3D space
        for (let z = 0; z < depth - 1; z++) {
            for (let y = 0; y < height - 1; y++) {
                for (let x = 0; x < width - 1; x++) {
                    // Get the 8 cell IDs in the 2x2x2 cube
                    const cellIDs = new Set();
                    
                    // Add all 8 corner cell IDs
                    cellIDs.add(getCellID(x, y, z));
                    cellIDs.add(getCellID(x + 1, y, z));
                    cellIDs.add(getCellID(x, y + 1, z));
                    cellIDs.add(getCellID(x + 1, y + 1, z));
                    cellIDs.add(getCellID(x, y, z + 1));
                    cellIDs.add(getCellID(x + 1, y, z + 1));
                    cellIDs.add(getCellID(x, y + 1, z + 1));
                    cellIDs.add(getCellID(x + 1, y + 1, z + 1));
                    
                    // Remove invalid cell IDs
                    cellIDs.delete(-1);
                    
                    // If we have 4 or more different cells meeting, it's a proper 3D junction
                    if (cellIDs.size >= 4) {
                        // Convert to world coordinates [-1, 1]
                        const worldPos = new THREE.Vector3(
                            (x + 0.5) / width * 2 - 1,
                            (y + 0.5) / height * 2 - 1,
                            (z + 0.5) / depth * 2 - 1
                        );
                        
                        vertices.push({
                            position: worldPos,
                            cellIDs: Array.from(cellIDs)
                        });
                    }
                }
            }
        }
        
        console.log(`✅ Found ${vertices.length} junctions`);
        return vertices;
    }
    
    /**
     * Log comprehensive analysis statistics
     */
    logAnalysisStatistics() {
        // Centroid statistics
        const centroidDistances = this.seedData.map(seed => 
            seed.position.distanceTo(seed.centroid)
        );
        const avgCentroidDistance = centroidDistances.reduce((a, b) => a + b, 0) / centroidDistances.length;
        const maxCentroidDistance = Math.max(...centroidDistances);
        
        // Acute count statistics
        const acuteCounts = this.seedData.map(seed => seed.acuteCount);
        const minAcute = Math.min(...acuteCounts);
        const maxAcute = Math.max(...acuteCounts);
        const avgAcute = acuteCounts.reduce((a, b) => a + b, 0) / acuteCounts.length;
        
        // Voxel count statistics
        const voxelCounts = this.seedData.map(seed => seed.voxelCount);
        const minVoxels = Math.min(...voxelCounts);
        const maxVoxels = Math.max(...voxelCounts);
        const avgVoxels = voxelCounts.reduce((a, b) => a + b, 0) / voxelCounts.length;
        
        console.log(`📊 Centroid Analysis: avg_distance=${avgCentroidDistance.toFixed(3)}, max_distance=${maxCentroidDistance.toFixed(3)}`);
        console.log(`📊 Acute Count: min=${minAcute}, max=${maxAcute}, avg=${avgAcute.toFixed(1)}`);
        console.log(`📊 Voxel Count: min=${minVoxels}, max=${maxVoxels}, avg=${avgVoxels.toFixed(1)}`);
        
        // Distribution analysis
        const acuteDistribution = {};
        acuteCounts.forEach(count => {
            const range = Math.floor(count / 5) * 5;
            acuteDistribution[range] = (acuteDistribution[range] || 0) + 1;
        });
        
        console.log(`📊 Acute count distribution:`, acuteDistribution);
    }
    
    /**
     * Get analysis results for visualization and debugging
     */
    getAnalysisResults() {
        return {
            vertices: this.vertices,
            lastAnalysisTime: this.lastAnalysisTime,
            vertexCount: this.vertices.length,
            seedData: this.seedData.map(seed => ({
                position: seed.position.clone(),
                centroid: seed.centroid.clone(),
                acuteCount: seed.acuteCount,
                voxelCount: seed.voxelCount
            }))
        };
    }
    
    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        return {
            lastAnalysisTime: this.lastAnalysisTime,
            vertexCount: this.vertices.length,
            seedCount: this.seedData.length,
            avgVoxelsPerSeed: this.seedData.length > 0 ? 
                this.seedData.reduce((sum, seed) => sum + seed.voxelCount, 0) / this.seedData.length : 0
        };
    }
    
    /**
     * Clear analysis cache and reset state
     */
    clearCache() {
        this.analysisCache.clear();
        this.vertices = [];
        console.log('🧹 Analysis cache cleared');
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        console.log('🧹 Disposing VoronoiAnalyzer...');
        
        this.vertices = [];
        this.analysisCache.clear();
        this.seedData = [];
        
        console.log('✅ VoronoiAnalyzer disposed');
    }
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.VoronoiAnalyzer = VoronoiAnalyzer;
} 