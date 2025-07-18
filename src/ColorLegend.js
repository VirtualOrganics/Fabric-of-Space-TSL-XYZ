import * as THREE from 'three';

/**
 * ColorLegend - Interactive color legend for acute angle visualization
 * 
 * This class creates a color legend system that:
 * 1. Shows the distribution of cells by acute angle count
 * 2. Allows interactive color customization
 * 3. Provides real-time statistics
 * 4. Updates colors in both points and volume rendering
 */
export class ColorLegend {
    constructor() {
        this.legendElement = null;
        this.colorRanges = [
            { min: 0, max: 10, color: new THREE.Color(0x0000ff), name: 'Very Low', count: 0 },
            { min: 11, max: 20, color: new THREE.Color(0x00ffff), name: 'Low', count: 0 },
            { min: 21, max: 30, color: new THREE.Color(0x00ff00), name: 'Medium', count: 0 },
            { min: 31, max: 40, color: new THREE.Color(0xffff00), name: 'High', count: 0 },
            { min: 41, max: 50, color: new THREE.Color(0xff8000), name: 'Very High', count: 0 },
            { min: 51, max: 999, color: new THREE.Color(0xff0000), name: 'Extreme', count: 0 }
        ];
        
        this.totalCells = 0;
        this.enabled = true;
        
        console.log('🎨 ColorLegend constructor completed');
    }
    
    /**
     * Initialize the color legend UI
     */
    init() {
        this.createLegendElement();
        this.updateLegend([]);
        
        console.log('✅ ColorLegend initialized');
    }
    
    /**
     * Create the legend DOM element
     */
    createLegendElement() {
        // Create legend container
        this.legendElement = document.createElement('div');
        this.legendElement.id = 'colorLegend';
        this.legendElement.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 20px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 1000;
            min-width: 280px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;
        
        // Add to document
        document.body.appendChild(this.legendElement);
        
        // Create initial content
        this.updateLegendContent();
    }
    
    /**
     * Update legend content with current data
     */
    updateLegendContent() {
        if (!this.legendElement) return;
        
        const totalCells = this.colorRanges.reduce((sum, range) => sum + range.count, 0);
        
        this.legendElement.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #00ffff; font-size: 16px;">Cell Acute Angles</h3>
                <button id="toggleLegend" style="
                    background: rgba(0, 255, 255, 0.2);
                    border: 1px solid #00ffff;
                    color: #00ffff;
                    padding: 5px 10px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 12px;
                ">Hide</button>
            </div>
            <div id="legendContent" style="transition: all 0.3s ease;">
                ${this.colorRanges.map((range, index) => this.createRangeElement(range, index, totalCells)).join('')}
                <div style="
                    margin-top: 15px;
                    padding-top: 15px;
                    border-top: 1px solid rgba(255, 255, 255, 0.2);
                    text-align: center;
                    font-size: 12px;
                    color: #aaa;
                ">
                    Total Cells: <span style="color: #00ffff; font-weight: bold;">${totalCells}</span>
                </div>
                <div style="
                    margin-top: 10px;
                    text-align: center;
                    font-size: 11px;
                    color: #666;
                ">
                    Click colors to customize
                </div>
            </div>
        `;
        
        // Add event listeners
        this.addEventListeners();
    }
    
    /**
     * Create a single range element
     */
    createRangeElement(range, index, totalCells) {
        const percentage = totalCells > 0 ? Math.round((range.count / totalCells) * 100) : 0;
        const colorHex = '#' + range.color.getHexString();
        
        return `
            <div style="
                display: flex;
                align-items: center;
                margin-bottom: 10px;
                padding: 8px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                transition: background 0.2s ease;
            " onmouseover="this.style.background='rgba(255, 255, 255, 0.1)'" 
               onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'">
                <input type="color" 
                       id="colorPicker${index}" 
                       value="${colorHex}"
                       style="
                           width: 30px;
                           height: 20px;
                           border: none;
                           border-radius: 4px;
                           cursor: pointer;
                           margin-right: 10px;
                       ">
                <div style="flex: 1;">
                    <div style="
                        font-size: 12px;
                        font-weight: bold;
                        color: ${colorHex};
                        margin-bottom: 2px;
                    ">${range.min}-${range.max === 999 ? '∞' : range.max}</div>
                    <div style="
                        font-size: 10px;
                        color: #aaa;
                    ">${range.name}</div>
                </div>
                <div style="
                    text-align: right;
                    min-width: 60px;
                ">
                    <div style="
                        font-size: 14px;
                        font-weight: bold;
                        color: #00ffff;
                    ">${range.count}</div>
                    <div style="
                        font-size: 10px;
                        color: #666;
                    ">${percentage}%</div>
                </div>
            </div>
        `;
    }
    
    /**
     * Add event listeners to legend elements
     */
    addEventListeners() {
        // Toggle legend visibility
        const toggleBtn = document.getElementById('toggleLegend');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const content = document.getElementById('legendContent');
                const isHidden = content.style.display === 'none';
                
                content.style.display = isHidden ? 'block' : 'none';
                toggleBtn.textContent = isHidden ? 'Hide' : 'Show';
            });
        }
        
        // Color picker event listeners
        this.colorRanges.forEach((range, index) => {
            const colorPicker = document.getElementById(`colorPicker${index}`);
            if (colorPicker) {
                colorPicker.addEventListener('change', (e) => {
                    const newColor = new THREE.Color(e.target.value);
                    this.colorRanges[index].color = newColor;
                    
                    // Notify listeners of color change
                    this.onColorChange && this.onColorChange(index, newColor);
                    
                    console.log(`🎨 Color range ${index} changed to ${e.target.value}`);
                });
            }
        });
    }
    
    /**
     * Update legend with new acute angle data
     */
    updateLegend(seedData) {
        if (!this.enabled || !seedData) return;

        // 1) Compute real max acute count
        const counts = seedData.map(s => s.acuteCount || 0);
        const maxCount = counts.length ? Math.max(...counts) : 0;

        // 2) Build N equal buckets
        const N = this.colorRanges.length;
        const step = Math.ceil((maxCount + 1) / N);

        // Preserve each bucket's color & name, reset min/max and count
        this.colorRanges = this.colorRanges.map((range, i) => ({
            name:  range.name,
            color: range.color,
            min:   i * step,
            max:   (i === N - 1) ? Infinity : ((i + 1) * step - 1),
            count: 0
        }));

        // 3) Re‑count seeds into new buckets
        seedData.forEach(seed => {
            const c = seed.acuteCount || 0;
            // Determine which bucket index
            let idx = Math.floor(c / step);
            if (idx >= N) idx = N - 1;
            this.colorRanges[idx].count++;
        });

        this.totalCells = seedData.length;

        // 4) Redraw UI
        this.updateLegendContent();

        console.log(`📊 Legend updated: ${this.totalCells} cells, maxCount=${maxCount}, step=${step}`);
    }
    
    /**
     * Get color for a specific acute count
     */
    getColorForAcuteCount(acuteCount) {
        const range = this.colorRanges.find(r => acuteCount >= r.min && acuteCount <= r.max);
        return range ? range.color : new THREE.Color(0x888888);
    }
    
    /**
     * Get color as HSL for smooth interpolation
     */
    getInterpolatedColor(acuteCount) {
        // Find the two ranges this value falls between
        let lowerRange = null;
        let upperRange = null;
        
        for (let i = 0; i < this.colorRanges.length - 1; i++) {
            if (acuteCount >= this.colorRanges[i].min && acuteCount <= this.colorRanges[i + 1].min) {
                lowerRange = this.colorRanges[i];
                upperRange = this.colorRanges[i + 1];
                break;
            }
        }
        
        if (!lowerRange || !upperRange) {
            return this.getColorForAcuteCount(acuteCount);
        }
        
        // Interpolate between colors
        const t = (acuteCount - lowerRange.min) / (upperRange.min - lowerRange.min);
        const color = new THREE.Color();
        color.lerpColors(lowerRange.color, upperRange.color, t);
        
        return color;
    }
    
    /**
     * Set color change callback
     */
    onColorChange(callback) {
        this.onColorChange = callback;
    }
    
    /**
     * Enable/disable the legend
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (this.legendElement) {
            this.legendElement.style.display = enabled ? 'block' : 'none';
        }
    }
    
    /**
     * Get current color ranges
     */
    getColorRanges() {
        return this.colorRanges;
    }
    
    /**
     * Set custom color ranges
     */
    setColorRanges(ranges) {
        this.colorRanges = ranges;
        this.updateLegendContent();
    }
    
    /**
     * Export current settings
     */
    exportSettings() {
        return {
            colorRanges: this.colorRanges.map(range => ({
                min: range.min,
                max: range.max,
                color: '#' + range.color.getHexString(),
                name: range.name
            })),
            enabled: this.enabled
        };
    }
    
    /**
     * Import settings
     */
    importSettings(settings) {
        if (settings.colorRanges) {
            this.colorRanges = settings.colorRanges.map(range => ({
                ...range,
                color: new THREE.Color(range.color),
                count: 0
            }));
        }
        
        if (typeof settings.enabled === 'boolean') {
            this.setEnabled(settings.enabled);
        }
        
        this.updateLegendContent();
    }
    
    /**
     * Dispose of the legend
     */
    dispose() {
        console.log('🧹 Disposing ColorLegend...');
        
        if (this.legendElement && this.legendElement.parentNode) {
            this.legendElement.parentNode.removeChild(this.legendElement);
        }
        
        console.log('✅ ColorLegend disposed');
    }
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.ColorLegend = ColorLegend;
} 