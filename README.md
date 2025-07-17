# Fabric of Space Z

**A hybrid GPU-accelerated Voronoi physics simulation combining the speed of Jump Flooding Algorithm with real-time acute angle analysis.**

## 🎮 [**Live Demo**](https://virtualorganics.github.io/Fabric-of-Space-Z/)

**Try it now: [https://virtualorganics.github.io/Fabric-of-Space-Z/](https://virtualorganics.github.io/Fabric-of-Space-Z/)**

## 🌟 Overview

Fabric of Space Z is a revolutionary hybrid system that combines:
- **GPU-powered Voronoi generation** using Jump Flooding Algorithm (JFA) 
- **CPU-based acute angle analysis** for geometric insights
- **Real-time physics simulation** with dynamic cell expansion/contraction
- **Interactive 3D visualization** with volume rendering

This project merges the speed of [JFA-3D-Voronoi-Atlas](https://github.com/VirtualOrganics/JFA-3D-Voronoi-Atlas) with the analytical power of [Fabric-of-Space-Y](https://github.com/VirtualOrganics/Fabric-of-Space-Y).

## 🚀 Features

### **Core Capabilities**
- **Real-time 3D Voronoi Generation**: GPU-accelerated JFA for instant Voronoi diagrams
- **Acute Angle Detection**: CPU analysis finds junction points and calculates angles
- **Physics-Based Dynamics**: Cells expand/contract based on their acute angle counts
- **Interactive Visualization**: 3D volume rendering with customizable colors and transparency
- **Performance Optimized**: ~20x faster than traditional Delaunay-based approaches

### **Interactive Controls**
- **Generation Settings**: Adjust point count (10-1000) and resolution (32³-256³)
- **Physics Parameters**: Threshold, growth rate, force strength, and multiple modes
- **Visualization Options**: Transparency, edges, points, and acuteness-based coloring
- **Real-time Statistics**: FPS monitoring, timing breakdown, and cell analysis

## 🎯 How It Works

### **Hybrid Pipeline**
1. **GPU JFA Pass**: Generate 3D Voronoi diagram using Jump Flooding Algorithm
2. **CPU Analysis**: Find junctions and calculate acute angles between cell boundaries  
3. **Physics Update**: Move generator points based on acute angle counts
4. **Visualization**: Render 3D volume with real-time updates

### **Physics Behavior**
- **High Acuteness Cells** (red): Expand outward by moving generators away from centroids
- **Low Acuteness Cells** (blue): Contract inward by moving generators toward centroids
- **Balanced Dynamics**: Growing cells push boundaries, shrinking cells pull them in

## 🛠️ Installation & Usage

### **Prerequisites**
- Modern web browser with WebGL 2.0 support
- Python 3.x for local development server

### **Quick Start**
```bash
# Clone the repository
git clone https://github.com/VirtualOrganics/Fabric-of-Space-Z.git
cd Fabric-of-Space-Z

# Start local server
python3 -m http.server 8001

# Open in browser
open http://localhost:8001
```

### **Controls**
1. **Enable Physics**: Check the physics checkbox to start simulation
2. **Adjust Threshold**: Controls which cells grow vs shrink (0-60 range)
3. **Set Growth Rate**: Controls speed of expansion/contraction
4. **Choose Mode**: 
   - `Balanced`: High acuteness grows, low shrinks
   - `Growth Only`: Only high acuteness cells expand
   - `Shrink Only`: Only high acuteness cells contract
   - `Inverse`: High acuteness shrinks, low grows

## 📊 Performance

### **Benchmarks**
- **JFA Generation**: ~2ms for 64³ volume with 1000 points
- **Acute Analysis**: ~49ms for complete geometric analysis
- **Total Frame Time**: ~51ms (20 FPS) vs 500-1000ms+ in traditional methods

### **Scalability**
- **Points**: 10-1000 generator points
- **Resolution**: 32³ to 256³ volume resolution
- **Real-time**: Maintains interactive frame rates

## 🔬 Technical Details

### **System Architecture**

Fabric of Space Z represents a unique hybrid approach that combines components from multiple repositories:

#### **Component Origins**
- **GPU JFA Core**: Adapted from [JFA-3D-Voronoi-Atlas](https://github.com/VirtualOrganics/JFA-3D-Voronoi-Atlas)
- **Acute Angle Analysis**: Inspired by [Fabric-of-Space-Y](https://github.com/VirtualOrganics/Fabric-of-Space-Y)
- **Physics Implementation**: Custom hybrid approach combining both systems
- **Geogram Integration**: **Not directly used** - replaced with GPU-based JFA approach

#### **Key System Components**
- **HybridVoronoiSystem**: Main orchestrator coordinating GPU/CPU pipeline
- **GPUVoronoiCompute**: WebGL-based JFA implementation with weighted Voronoi support
- **VoronoiAnalyzer**: CPU-based junction detection and acute angle calculation
- **PhysicsEngine**: Centroid-based expansion/contraction dynamics
- **VolumeRenderer**: 3D visualization with ray marching and edge detection
- **ColorLegend**: Interactive color mapping and statistics display

## 🔍 **Acute Angle Detection Algorithm**

### **Detection Pipeline**
The acute angle detection in Fabric of Space Z follows a fundamentally different approach than traditional Delaunay-based methods:

#### **1. Junction Finding (3D Discrete Space)**
```javascript
// Scan 2x2x2 cubes in 3D voxel space
for (let z = 0; z < volumeSize - 1; z++) {
    for (let y = 0; y < volumeSize - 1; y++) {
        for (let x = 0; x < volumeSize - 1; x++) {
            // Get 8 cell IDs in the cube
            const cellIDs = new Set();
            // Add all 8 corner cell IDs...
            
            // Junction = 4+ different cells meeting
            if (cellIDs.size >= 4) {
                // Found a Voronoi vertex!
                vertices.push({
                    position: worldPos,
                    cellIDs: Array.from(cellIDs)
                });
            }
        }
    }
}
```

#### **2. Angle Calculation at Junctions**
For each Voronoi vertex (junction), we calculate angles between seed vectors:

```javascript
// For each pair of cells meeting at this vertex
for (let i = 0; i < cellIDs.length; i++) {
    for (let j = i + 1; j < cellIDs.length; j++) {
        // Get seed positions
        const seed1 = seedData[cellIndex1];
        const seed2 = seedData[cellIndex2];
        
        // Calculate vectors from junction to seeds
        const vec1 = seed1.position - vertexPosition;
        const vec2 = seed2.position - vertexPosition;
        
        // Calculate angle between vectors
        const angle = Math.acos(
            vec1.dot(vec2) / (vec1.length() * vec2.length())
        );
        
        // Count acute angles (< 90°)
        if (angle < Math.PI / 2) {
            seed1.acuteCount++;
            seed2.acuteCount++;
        }
    }
}
```

#### **3. Key Differences from Fabric-of-Space-Y**
- **Discrete vs Continuous**: Uses voxel-based junction detection instead of exact Delaunay vertices
- **JFA Output**: Processes GPU-generated cell IDs rather than geometric tetrahedra
- **Performance**: ~49ms analysis vs 500-1000ms+ in Delaunay-based approach
- **Scalability**: Handles 1000+ points in real-time vs limited point counts in exact methods

## ⚡ **Physics Engine Deep Dive**

### **Physics Philosophy**
The physics system implements **centroid-based expansion/contraction**, fundamentally different from traditional force-based approaches:

#### **Core Principle**
- **Expansion**: Move generator **away** from cell centroid → cell grows
- **Contraction**: Move generator **toward** cell centroid → cell shrinks
- **No Inter-cell Forces**: Unlike molecular dynamics, cells don't push/pull each other directly

### **Physics Pipeline**

#### **1. Acuteness-Based Growth Decision**
```javascript
// Determine growth behavior based on acute angle count
switch (mode) {
    case 'balanced':
        if (acuteCount > threshold) {
            shouldGrow = true;  // High acuteness → expand
        } else {
            shouldGrow = false; // Low acuteness → contract
        }
        break;
    // ... other modes
}
```

#### **2. Flux Calculation**
```javascript
// Calculate growth strength based on distance from threshold
const fluxMagnitude = Math.abs(acuteCount - threshold);
const rawFlux = Math.pow(fluxMagnitude, growthPower) * (shouldGrow ? 1 : -1);

// Normalize across all cells
const normalizedFlux = rawFlux / maxFlux;
```

#### **3. Centroid-Based Movement**
```javascript
// Calculate direction from centroid to generator
const direction = {
    x: generator.x - centroid.x,
    y: generator.y - centroid.y,
    z: generator.z - centroid.z
};

// Apply movement based on flux
const delta = growthRate * normalizedFlux;
generator.x += direction.x * delta;
generator.y += direction.y * delta;
generator.z += direction.z * delta;
```

#### **4. Momentum and Damping**
```javascript
// Apply momentum from previous frame
const prevDelta = this.previousDeltas.get(cellIndex) || 0;
const dampedDelta = damping * prevDelta + (1 - damping) * delta;

// Clamp to prevent instability
const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, dampedDelta));
```

### **Physics Modes Explained**

#### **Balanced Mode** (Default)
- **High Acuteness** (red cells): Expand outward
- **Low Acuteness** (blue cells): Contract inward
- **Result**: System seeks geometric equilibrium

#### **Growth Only Mode**
- **High Acuteness**: Expand outward
- **Low Acuteness**: No movement
- **Result**: Only "spiky" cells grow

#### **Shrink Only Mode**
- **High Acuteness**: Contract inward
- **Low Acuteness**: No movement
- **Result**: Only "spiky" cells shrink

#### **Inverse Mode**
- **High Acuteness**: Contract inward
- **Low Acuteness**: Expand outward
- **Result**: Opposite of natural behavior

### **Why This Approach Works**
1. **Geometric Intuition**: Acute angles indicate "spiky" or irregular cells
2. **Natural Behavior**: Irregular cells tend to regularize through expansion/contraction
3. **Stability**: Centroid-based movement is inherently stable
4. **Performance**: No complex force calculations between all cell pairs

## 🔧 **Repository Integration**

### **From JFA-3D-Voronoi-Atlas**
- **Core JFA Algorithm**: 3D Jump Flooding implementation
- **Atlas Mapping**: 3D-to-2D texture storage technique
- **GPU Shaders**: WebGL compute shader architecture
- **Performance Optimizations**: Multi-pass JFA with logarithmic steps

### **From Fabric-of-Space-Y**
- **Acute Angle Concept**: Geometric analysis of cell irregularity
- **Growth Modes**: Multiple expansion/contraction behaviors
- **UI Design**: Control panel layout and interaction patterns
- **Color Legend**: Interactive acute angle distribution display

### **Novel Hybrid Contributions**
- **GPU-CPU Pipeline**: Seamless integration of JFA output with CPU analysis
- **Real-time Physics**: 20x performance improvement over Delaunay-based approach
- **Weighted Voronoi**: Dynamic cell weights for physics-based growth
- **Volume Rendering**: 3D visualization with ray marching and edge detection

### **Geogram Dependency Status**
- **Original Fabric-of-Space-Y**: Heavy dependency on Geogram's Delaunay triangulation
- **Fabric-of-Space-Z**: **No Geogram dependency** - pure JavaScript/WebGL implementation
- **Advantage**: Eliminates WASM compilation complexity and cross-platform issues
- **Trade-off**: Discrete voxel-based analysis vs exact geometric calculations

## 🎨 Visualization Features

### **Color Legend**
- **Interactive Color Mapping**: Click colors to customize acute angle ranges
- **Real-time Distribution**: Live cell count breakdown by acuteness levels
- **Percentage Display**: Visual feedback on cell population distribution

### **3D Rendering**
- **Volume Ray Marching**: True 3D Voronoi cell visualization
- **Edge Detection**: Cyan edges highlight cell boundaries
- **Transparency Control**: Adjustable opacity for interior visualization
- **Point Size Control**: Configurable generator point display

## 📈 Future Enhancements

- **Periodic Boundary Conditions**: Full torus topology support
- **Advanced Physics Modes**: More sophisticated growth dynamics
- **Export Capabilities**: Save configurations and animations
- **WebAssembly Acceleration**: Further performance optimizations

## 🤝 Contributing

This project builds upon the foundation of computational geometry research. Contributions are welcome for:
- Performance optimizations
- New physics modes
- Visualization enhancements
- Documentation improvements

## 📄 License

This project is part of the VirtualOrganics computational geometry suite. See LICENSE file for details.

## 🔗 Related Projects

- [Fabric-of-Space-Y](https://github.com/VirtualOrganics/Fabric-of-Space-Y): Original Delaunay-based system
- [JFA-3D-Voronoi-Atlas](https://github.com/VirtualOrganics/JFA-3D-Voronoi-Atlas): GPU JFA implementation
- [Geogram-Three.js](https://github.com/VirtualOrganics/Geogram-Three.js): 3D computational geometry

---

**Experience the future of real-time computational geometry with Fabric of Space Z!** 