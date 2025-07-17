# Fabric of Space Z

**A hybrid GPU-accelerated Voronoi physics simulation combining the speed of Jump Flooding Algorithm with real-time acute angle analysis.**

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

### **Architecture**
- **HybridVoronoiSystem**: Main orchestrator coordinating GPU/CPU pipeline
- **GPUVoronoiCompute**: WebGL-based JFA implementation with weighted Voronoi
- **VoronoiAnalyzer**: CPU-based junction detection and angle calculation
- **PhysicsEngine**: Centroid-based expansion/contraction dynamics
- **VolumeRenderer**: 3D visualization with ray marching and edge detection

### **Key Innovations**
- **3D JFA Atlas Mapping**: Efficient 3D-to-2D texture mapping for GPU processing
- **Weighted Voronoi Support**: Dynamic cell weights for physics-based growth
- **Junction Detection**: Robust 3D junction finding in discrete voxel space
- **Acute Angle Analysis**: Precise geometric calculations for cell characterization

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