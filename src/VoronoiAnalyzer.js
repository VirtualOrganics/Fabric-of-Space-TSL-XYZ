import * as THREE from 'three';

/**
 * VoronoiAnalyzer - CPU module for analyzing JFA output and calculating acute angles
 * 
 * This class implements the CPU analysis described in Phase 3:
 * 1. Finds all junctions (Voronoi vertices) in the JFA output
 * 2. Calculates angles at each junction between seed vectors
 * 3. Counts acute angles for each cell
 */
export class VoronoiAnalyzer {
    constructor() {
        this.vertices = [];
        this.analysisCache = new Map();
        this.lastAnalysisTime = 0;
        
        // Temporary vectors for calculations (reused for performance)
        this.tempVec1 = new THREE.Vector3();
        this.tempVec2 = new THREE.Vector3();
        this.tempVec3 = new THREE.Vector3();
        
        console.log('🔍 VoronoiAnalyzer constructor completed');
    }
    
    /**
     * Main analysis function - processes JFA output and updates seed data
     */
    analyze(jfaOutput, seedData, volumeSize) {
        const startTime = performance.now();
        
        if (!jfaOutput || !jfaOutput.data) {
            console.warn('⚠️ No JFA output data provided');
            return;
        }
        
        console.log(`🔍 Starting analysis of ${volumeSize}³ volume...`);
        
        try {
            // Reset acute counts for all seeds
            this.resetAcuteCounts(seedData);
            
            // Clear previous analysis
            this.vertices = [];
            
            // Step 1: Find all junctions (Voronoi vertices)
            this.findJunctions(jfaOutput, volumeSize);
            
            // Step 2: Calculate angles at each junction
            this.calculateAngles(seedData);
            
            this.lastAnalysisTime = Math.round(performance.now() - startTime);
            
            console.log(`✅ Analysis completed in ${this.lastAnalysisTime}ms`);
            console.log(`📊 Found ${this.vertices.length} Voronoi vertices`);
            
        } catch (error) {
            console.error('❌ Error in Voronoi analysis:', error);
            this.lastAnalysisTime = 0;
        }
    }
    
    /**
     * Reset acute counts for all seeds
     */
    resetAcuteCounts(seedData) {
        seedData.forEach(seed => {
            seed.acuteCount = 0;
        });
    }
    
    /**
     * Find all junctions (Voronoi vertices) in the JFA output
     */
    findJunctions(jfaOutput, volumeSize) {
        console.log('🔍 Finding junctions...');
        
        const { data, width, height, slicesPerRow } = jfaOutput;
        const atlasSize = width;
        
        // Helper function to convert atlas coordinates to volume coordinates
        const atlasToVolume = (atlasX, atlasY) => {
            const sliceX = Math.floor(atlasX / volumeSize);
            const sliceY = Math.floor(atlasY / volumeSize);
            const slice = sliceY * slicesPerRow + sliceX;
            
            const inSliceX = atlasX % volumeSize;
            const inSliceY = atlasY % volumeSize;
            
            return {
                x: inSliceX / volumeSize,
                y: inSliceY / volumeSize,
                z: slice / volumeSize,
                valid: slice < volumeSize
            };
        };
        
        // Helper function to get cell ID from atlas data
        const getCellID = (atlasX, atlasY) => {
            if (atlasX < 0 || atlasX >= atlasSize || atlasY < 0 || atlasY >= atlasSize) {
                return 0;
            }
            
            const index = (atlasY * atlasSize + atlasX) * 4;
            return data[index + 3]; // Cell ID is in the alpha channel
        };
        
        // Scan for junctions by checking 2x2x2 cubes in 3D space
        for (let z = 0; z < volumeSize - 1; z++) {
            for (let y = 0; y < volumeSize - 1; y++) {
                for (let x = 0; x < volumeSize - 1; x++) {
                    // Convert 3D coordinates to atlas coordinates
                    const sliceX = z % slicesPerRow;
                    const sliceY = Math.floor(z / slicesPerRow);
                    
                    const atlasX = sliceX * volumeSize + x;
                    const atlasY = sliceY * volumeSize + y;
                    
                    // Get the 8 cell IDs in the 2x2x2 cube
                    const cellIDs = new Set();
                    
                    // Current slice (z)
                    cellIDs.add(getCellID(atlasX, atlasY));
                    cellIDs.add(getCellID(atlasX + 1, atlasY));
                    cellIDs.add(getCellID(atlasX, atlasY + 1));
                    cellIDs.add(getCellID(atlasX + 1, atlasY + 1));
                    
                    // Next slice (z + 1)
                    const nextSliceX = (z + 1) % slicesPerRow;
                    const nextSliceY = Math.floor((z + 1) / slicesPerRow);
                    const nextAtlasX = nextSliceX * volumeSize + x;
                    const nextAtlasY = nextSliceY * volumeSize + y;
                    
                    if (z + 1 < volumeSize) {
                        cellIDs.add(getCellID(nextAtlasX, nextAtlasY));
                        cellIDs.add(getCellID(nextAtlasX + 1, nextAtlasY));
                        cellIDs.add(getCellID(nextAtlasX, nextAtlasY + 1));
                        cellIDs.add(getCellID(nextAtlasX + 1, nextAtlasY + 1));
                    }
                    
                    // Remove invalid cell IDs (0 means no cell)
                    cellIDs.delete(0);
                    
                    // If we have 4 or more different cells meeting, it's a proper 3D junction
                    // (In 3D, we need at least 4 cells to form a proper Voronoi vertex)
                    if (cellIDs.size >= 4) {
                        // Convert back to world coordinates [-1, 1]
                        const worldPos = new THREE.Vector3(
                            (x + 0.5) / volumeSize * 2 - 1,
                            (y + 0.5) / volumeSize * 2 - 1,
                            (z + 0.5) / volumeSize * 2 - 1
                        );
                        
                        this.vertices.push({
                            position: worldPos,
                            cellIDs: Array.from(cellIDs)
                        });
                    }
                }
            }
        }
        
        console.log(`✅ Found ${this.vertices.length} junctions`);
    }
    
    /**
     * Calculate angles at each junction and count acute angles
     */
    calculateAngles(seedData) {
        console.log('📐 Calculating angles...');
        
        let totalAngles = 0;
        let acuteAngles = 0;
        
        // Process each Voronoi vertex
        this.vertices.forEach(vertex => {
            const { position, cellIDs } = vertex;
            
            // For each unique pair of cells at this vertex
            for (let i = 0; i < cellIDs.length; i++) {
                for (let j = i + 1; j < cellIDs.length; j++) {
                    const cellID1 = cellIDs[i];
                    const cellID2 = cellIDs[j];
                    
                    // Convert normalized cell IDs back to seed indices
                    const seedIndex1 = Math.round(cellID1 * seedData.length) - 1;
                    const seedIndex2 = Math.round(cellID2 * seedData.length) - 1;
                    
                    // Validate seed indices
                    if (seedIndex1 >= 0 && seedIndex1 < seedData.length &&
                        seedIndex2 >= 0 && seedIndex2 < seedData.length &&
                        seedIndex1 !== seedIndex2) {
                        
                        const seed1 = seedData[seedIndex1];
                        const seed2 = seedData[seedIndex2];
                        
                        // Calculate vectors from vertex to each seed
                        this.tempVec1.subVectors(seed1.position, position);
                        this.tempVec2.subVectors(seed2.position, position);
                        
                        // Check for zero-length vectors
                        const len1 = this.tempVec1.length();
                        const len2 = this.tempVec2.length();
                        
                        if (len1 > 0.001 && len2 > 0.001) {
                            this.tempVec1.normalize();
                            this.tempVec2.normalize();
                            
                            // Calculate angle between vectors
                            const dotProduct = this.tempVec1.dot(this.tempVec2);
                            const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
                            
                            totalAngles++;
                            
                            // Check if angle is acute (< 90 degrees)
                            if (angle < Math.PI / 2) {
                                acuteAngles++;
                                
                                // Increment acute count for both seeds
                                seed1.acuteCount++;
                                seed2.acuteCount++;
                            }
                        }
                    }
                }
            }
        });
        
        console.log(`✅ Processed ${totalAngles} angles, ${acuteAngles} acute (${Math.round(acuteAngles/totalAngles*100)}%)`);
        
        // Log statistics about acute counts
        this.logAcuteStatistics(seedData);
        
        // Debug: Log some example calculations
        this.debugAnalysis(seedData);
    }
    
    /**
     * Log statistics about acute angle counts
     */
    logAcuteStatistics(seedData) {
        const acuteCounts = seedData.map(seed => seed.acuteCount);
        const min = Math.min(...acuteCounts);
        const max = Math.max(...acuteCounts);
        const avg = acuteCounts.reduce((a, b) => a + b, 0) / acuteCounts.length;
        
        // Count distribution
        const distribution = {};
        acuteCounts.forEach(count => {
            const range = Math.floor(count / 10) * 10;
            distribution[range] = (distribution[range] || 0) + 1;
        });
        
        console.log(`📊 Acute count statistics: min=${min}, max=${max}, avg=${avg.toFixed(1)}`);
        console.log(`📊 Distribution by ranges:`, distribution);
    }
    
    /**
     * Debug analysis to understand the acute angle calculations
     */
    debugAnalysis(seedData) {
        console.log(`🔍 Debug: Found ${this.vertices.length} Voronoi vertices`);
        
        // Sample a few vertices for detailed analysis
        const sampleVertices = this.vertices.slice(0, Math.min(5, this.vertices.length));
        
        sampleVertices.forEach((vertex, i) => {
            console.log(`🔍 Vertex ${i}: position=(${vertex.position.x.toFixed(2)}, ${vertex.position.y.toFixed(2)}, ${vertex.position.z.toFixed(2)}), cells=[${vertex.cellIDs.join(', ')}]`);
            
            // Check if cell IDs are valid
            vertex.cellIDs.forEach(cellID => {
                const seedIndex = Math.round(cellID * seedData.length) - 1;
                if (seedIndex < 0 || seedIndex >= seedData.length) {
                    console.warn(`⚠️ Invalid seed index: ${seedIndex} from cellID ${cellID}`);
                }
            });
        });
        
        // Sample a few seeds with their acute counts
        const sampleSeeds = seedData.slice(0, Math.min(10, seedData.length));
        console.log(`🔍 Sample seed acute counts:`, sampleSeeds.map((seed, i) => `${i}:${seed.acuteCount}`).join(', '));
    }
    
    /**
     * Get analysis results for visualization
     */
    getAnalysisResults() {
        return {
            vertices: this.vertices,
            lastAnalysisTime: this.lastAnalysisTime,
            vertexCount: this.vertices.length
        };
    }
    
    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        return {
            lastAnalysisTime: this.lastAnalysisTime,
            vertexCount: this.vertices.length,
            cacheSize: this.analysisCache.size
        };
    }
    
    /**
     * Clear analysis cache
     */
    clearCache() {
        this.analysisCache.clear();
        console.log('🧹 Analysis cache cleared');
    }
    
    /**
     * Helper function to calculate angle between two vectors
     */
    calculateAngle(vec1, vec2) {
        const dot = vec1.dot(vec2);
        const mag1 = vec1.length();
        const mag2 = vec2.length();
        
        if (mag1 === 0 || mag2 === 0) return 0;
        
        const cosAngle = dot / (mag1 * mag2);
        return Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    }
    
    /**
     * Advanced analysis with cell-specific metrics
     */
    analyzeAdvanced(jfaOutput, seedData, volumeSize) {
        console.log('🔬 Running advanced analysis...');
        
        // Run basic analysis first
        this.analyze(jfaOutput, seedData, volumeSize);
        
        // Additional metrics for each cell
        seedData.forEach((seed, index) => {
            // Calculate cell volume (approximate)
            seed.cellVolume = this.estimateCellVolume(index, jfaOutput, volumeSize);
            
            // Calculate cell surface area (approximate)
            seed.cellSurfaceArea = this.estimateCellSurfaceArea(index, jfaOutput, volumeSize);
            
            // Calculate cell regularity metric
            seed.cellRegularity = this.calculateCellRegularity(seed);
        });
        
        console.log('✅ Advanced analysis completed');
    }
    
    /**
     * Estimate cell volume from JFA output
     */
    estimateCellVolume(seedIndex, jfaOutput, volumeSize) {
        const { data, width, height } = jfaOutput;
        const targetCellID = (seedIndex + 1) / jfaOutput.numPoints;
        
        let voxelCount = 0;
        
        // Count voxels belonging to this cell
        for (let i = 3; i < data.length; i += 4) {
            if (Math.abs(data[i] - targetCellID) < 0.001) {
                voxelCount++;
            }
        }
        
        // Convert to normalized volume
        const totalVoxels = volumeSize * volumeSize * volumeSize;
        return voxelCount / totalVoxels;
    }
    
    /**
     * Estimate cell surface area from JFA output
     */
    estimateCellSurfaceArea(seedIndex, jfaOutput, volumeSize) {
        // This is a simplified estimation
        // In a full implementation, we would analyze boundary voxels
        return 0; // Placeholder
    }
    
    /**
     * Calculate cell regularity metric
     */
    calculateCellRegularity(seed) {
        // Simple regularity metric based on acute count
        // Lower acute count = more regular
        const maxExpectedAcute = 20; // Rough estimate
        return Math.max(0, 1 - (seed.acuteCount / maxExpectedAcute));
    }
    
    /**
     * Dispose of resources
     */
    dispose() {
        console.log('🧹 Disposing VoronoiAnalyzer...');
        
        this.vertices = [];
        this.analysisCache.clear();
        
        console.log('✅ VoronoiAnalyzer disposed');
    }
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.VoronoiAnalyzer = VoronoiAnalyzer;
} 