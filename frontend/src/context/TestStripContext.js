import React, { createContext, useState, useContext } from 'react';

const TestStripContext = createContext();

export const useTestStrip = () => useContext(TestStripContext);

export const TestStripProvider = ({ children }) => {
  const [image, setImage] = useState(null);
  const [detectedReadings, setDetectedReadings] = useState(null);
  const [adjustments, setAdjustments] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  // Color key for test strip readings
  const colorKey = {
    "Total Hardness": [
      { color: [86, 107, 87], value: 0 },      // Dark olive
      { color: [122, 93, 95], value: 25 },     // Mauve
      { color: [130, 95, 96], value: 50 },     // Darker mauve
      { color: [142, 98, 98], value: 120 },    // Reddish brown
      { color: [175, 108, 108], value: 250 },  // Light reddish brown
      { color: [189, 112, 112], value: 425 }   // Pink brown
    ],
    "Total Chlorine": [
      { color: [255, 253, 218], value: 0 },    // Pale yellow
      { color: [244, 246, 194], value: 0.5 },  // Light yellow-green
      { color: [226, 234, 181], value: 1 },    // Yellow-green
      { color: [201, 221, 156], value: 3 },    // Light green
      { color: [176, 208, 157], value: 5 },    // Mint green
      { color: [86, 190, 167], value: 10 },    // Turquoise
      { color: [68, 183, 168], value: 20 }     // Dark turquoise
    ],
    "Free Chlorine": [
      { color: [255, 255, 255], value: 0 },    // White
      { color: [255, 235, 238], value: 0.5 },  // Very light pink
      { color: [255, 214, 220], value: 1 },    // Light pink
      { color: [232, 145, 189], value: 3 },    // Medium pink
      { color: [201, 105, 157], value: 5 },    // Dark pink
      { color: [169, 91, 131], value: 10 },    // Purple pink
      { color: [142, 77, 112], value: 20 }     // Dark purple pink
    ],
    "Bromine": [
      { color: [255, 255, 255], value: 0 },    // White
      { color: [255, 235, 238], value: 1 },    // Very light pink
      { color: [232, 145, 189], value: 2 },    // Light pink
      { color: [201, 105, 157], value: 6 },    // Medium pink
      { color: [169, 91, 131], value: 10 },    // Dark pink
      { color: [142, 77, 112], value: 20 },    // Purple pink
      { color: [120, 65, 95], value: 40 }      // Dark purple pink
    ],
    "Total Alkalinity": [
      { color: [255, 244, 187], value: 0 },    // Light yellow
      { color: [199, 237, 183], value: 40 },   // Light green
      { color: [134, 197, 154], value: 80 },   // Medium green
      { color: [86, 158, 118], value: 120 },   // Forest green
      { color: [53, 128, 112], value: 180 },   // Dark green
      { color: [41, 100, 98], value: 240 },    // Very dark green
      { color: [33, 85, 85], value: 360 }      // Darkest green
    ],
    "Cyanuric Acid": [
      { color: [255, 200, 180], value: 0 },    // Light peach
      { color: [255, 190, 175], value: 30 },   // Peach
      { color: [255, 180, 170], value: 100 },  // Dark peach
      { color: [255, 170, 165], value: 150 },  // Pink peach
      { color: [255, 160, 160], value: 240 }   // Pink
    ],
    "pH": [
      { color: [255, 183, 159], value: 6.2 },  // Light orange
      { color: [255, 167, 147], value: 6.8 },  // Orange
      { color: [255, 152, 136], value: 7.2 },  // Dark orange
      { color: [255, 136, 124], value: 7.8 },  // Red orange
      { color: [255, 120, 113], value: 8.4 },  // Red
      { color: [255, 105, 105], value: 9.0 }   // Dark red
    ]
  };

  // Square positions (relative to image dimensions)
  const squarePositions = {
    "Total Hardness": { x: 0.5, y: 0.07 },
    "Total Chlorine": { x: 0.5, y: 0.21 },
    "Free Chlorine": { x: 0.5, y: 0.35 },
    "Bromine": { x: 0.5, y: 0.49 },
    "Total Alkalinity": { x: 0.5, y: 0.63 },
    "Cyanuric Acid": { x: 0.5, y: 0.77 },
    "pH": { x: 0.5, y: 0.91 }
  };

  const processImage = async (imageFile) => {
    setIsProcessing(true);
    setError(null);
    let imageUrl;

    try {
      if (!imageFile) {
        throw new Error('No image file provided');
      }

      imageUrl = URL.createObjectURL(imageFile);
      setImage(imageUrl);

      // Create a canvas to process the image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const img = new Image();

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
      });

      // Set canvas dimensions and scale if needed
      const maxDimension = 800;
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      // Draw image with scaling
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Process each square
      const readings = {};
      const partialReadings = {};
      const sampleSize = Math.min(20, Math.floor(canvas.width * 0.1)); // Adjust sample size based on image width

      for (const [parameter, position] of Object.entries(squarePositions)) {
        const x = Math.floor(position.x * canvas.width);
        const y = Math.floor(position.y * canvas.height);
        
        // Validate sampling area with padding
        const padding = sampleSize / 2;
        if (x < padding || y < padding || 
            x + padding > canvas.width || y + padding > canvas.height) {
          console.warn(`Sampling area out of bounds for ${parameter}, skipping...`);
          continue;
        }

        try {
          // Sample a larger area and take the median color to reduce noise
          const imageData = ctx.getImageData(
            x - padding,
            y - padding,
            sampleSize,
            sampleSize
          );

          // Calculate median color instead of average
          const colors = [];
          for (let i = 0; i < imageData.data.length; i += 4) {
            colors.push([
              imageData.data[i],
              imageData.data[i + 1],
              imageData.data[i + 2]
            ]);
          }

          if (colors.length === 0) {
            console.warn(`No colors sampled for ${parameter}, skipping...`);
            continue;
          }

          // Sort colors by brightness
          colors.sort((a, b) => {
            const brightnessA = (a[0] + a[1] + a[2]) / 3;
            const brightnessB = (b[0] + b[1] + b[2]) / 3;
            return brightnessA - brightnessB;
          });

          // Take the median color
          const medianIndex = Math.floor(colors.length / 2);
          const medianColor = colors[medianIndex];

          // Find closest matching color in the key
          const closestColor = findClosestColor(medianColor, colorKey[parameter]);
          if (!closestColor) {
            console.warn(`Could not match color for ${parameter}, skipping...`);
            continue;
          }
          readings[parameter] = closestColor.value;
          partialReadings[parameter] = closestColor.value;
        } catch (err) {
          console.error(`Error processing ${parameter}:`, err);
          // Store any successful readings before failing
          if (Object.keys(partialReadings).length > 0) {
            const error = new Error(`Failed to process ${parameter}. Some readings were detected.`);
            error.partialReadings = partialReadings;
            throw error;
          }
          throw new Error(`Failed to process ${parameter}. Please try again or enter readings manually.`);
        }
      }

      if (Object.keys(readings).length === 0) {
        throw new Error('Could not detect any readings. Please try again or enter readings manually.');
      }

      setDetectedReadings(readings);
      setError(null);
      return readings;
    } catch (err) {
      setError(err.message || 'Failed to process image');
      console.error('Image processing error:', err);
      setDetectedReadings(null);
      throw err; // Re-throw to trigger the fallback in TestStripUpload
    } finally {
      setIsProcessing(false);
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    }
  };

  const findClosestColor = (color, colorArray) => {
    let minDistance = Infinity;
    let closestColor = null;

    for (const entry of colorArray) {
      const distance = Math.sqrt(
        Math.pow(color[0] - entry.color[0], 2) +
        Math.pow(color[1] - entry.color[1], 2) +
        Math.pow(color[2] - entry.color[2], 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestColor = entry;
      }
    }

    return closestColor;
  };

  const clearState = () => {
    setImage(null);
    setDetectedReadings(null);
    setAdjustments(null);
    setError(null);
  };

  return (
    <TestStripContext.Provider
      value={{
        image,
        detectedReadings,
        adjustments,
        isProcessing,
        error,
        processImage,
        clearState,
        setAdjustments
      }}
    >
      {children}
    </TestStripContext.Provider>
  );
}; 