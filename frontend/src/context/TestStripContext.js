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
    "pH": [
      { color: [255, 182, 193], value: 6.8 }, // Light pink
      { color: [255, 105, 180], value: 7.2 }, // Hot pink
      { color: [148, 0, 211], value: 7.6 }    // Purple
    ],
    "Total Chlorine": [
      { color: [255, 255, 224], value: 0 },   // Light yellow
      { color: [255, 215, 0], value: 3 }      // Gold
    ],
    "Total Hardness": [
      { color: [255, 255, 255], value: 0 },   // White
      { color: [192, 192, 192], value: 250 }  // Silver
    ],
    "Total Alkalinity": [
      { color: [255, 255, 255], value: 0 },   // White
      { color: [192, 192, 192], value: 80 }   // Silver
    ],
    "Cyanuric Acid": [
      { color: [255, 255, 255], value: 0 },   // White
      { color: [192, 192, 192], value: 30 }   // Silver
    ]
  };

  // Square positions (relative to image dimensions)
  const squarePositions = {
    "pH": { x: 0.5, y: 0.1 },
    "Total Chlorine": { x: 0.5, y: 0.3 },
    "Free Chlorine": { x: 0.5, y: 0.5 },
    "Total Hardness": { x: 0.5, y: 0.7 },
    "Total Alkalinity": { x: 0.5, y: 0.85 },
    "Cyanuric Acid": { x: 0.5, y: 0.95 }
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