import React, { createContext, useState, useContext, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
// Assuming config file exists and has the backend URL
import config from '../config'; 

const TestStripContext = createContext();

export const useTestStrip = () => useContext(TestStripContext);

export const TestStripProvider = ({ children }) => {
  const [image, setImage] = useState(null); // Keep the uploaded image file or blob
  const [detectedReadings, setDetectedReadings] = useState(null);
  const [padCoordinates, setPadCoordinates] = useState(null); // NEW: For feedback overlay
  const [normalRanges, setNormalRanges] = useState(null); // NEW: For UI highlighting
  const [adjustments, setAdjustments] = useState(null); // Keep for calculation results
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [testStripSystem, setTestStripSystem] = useState('pool');
  const auth = getAuth(); // Get auth instance

  const processImage = async (imageFile, systemType) => {
    console.log('Processing image via backend...');
    setIsProcessing(true);
    setError(null);
    setDetectedReadings(null);
    setPadCoordinates(null); // Reset coordinates
    setNormalRanges(null); // Reset ranges
    setImage(imageFile); // Still useful to keep the image blob for display
    setTestStripSystem(systemType);

    try {
      if (!imageFile) {
        throw new Error('No image file provided');
      }

      // 1. Get Auth Token
      const user = auth.currentUser;
      if (!user) {
        throw new Error('User not authenticated');
      }
      const token = await user.getIdToken();

      // 2. Prepare Form Data
      const formData = new FormData();
      formData.append('image', imageFile, imageFile.name || 'teststrip.jpg');
      // Optional: Add systemType if needed by backend, though it's not currently used
      // formData.append('system', systemType);

      // 3. Fetch from Backend
      // TODO: Replace with actual deployed function URL or emulator URL from config
      const backendUrl = config.apiUrl + (config.endpoints.processTestStrip || '/process-test-strip'); 
      console.log(`Calling backend: ${backendUrl}`);
      
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          // 'Content-Type' is set automatically by browser for FormData
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      // 4. Handle Response
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend Error:', response.status, errorText);
        throw new Error(`Image processing failed: ${response.status} ${errorText || 'Backend error'}`);
      }

      const result = await response.json();
      console.log('Backend Result:', result);

      if (!result || !result.readings || !result.padCoordinates || !result.normalRanges) {
         throw new Error('Invalid response structure from backend');
      }

      // 5. Update State
      setDetectedReadings(result.readings);
      setPadCoordinates(result.padCoordinates);
      setNormalRanges(result.normalRanges);
      setError(null); // Clear previous errors on success

      // Return readings for potential chaining/immediate use
      return result.readings; 

    } catch (err) {
      console.error('Error in processImage:', err);
      setError(err.message || 'Failed to process image');
      // Keep partial state null if backend fails comprehensively
      setDetectedReadings(null); 
      setPadCoordinates(null);
      setNormalRanges(null);
      throw err; // Re-throw for UI components to handle
    } finally {
      setIsProcessing(false);
      // Note: No need to revokeObjectURL here as we didn't create one in this version
    }
  };

  const clearState = () => {
    setImage(null);
    setDetectedReadings(null);
    setPadCoordinates(null); // Clear new state
    setNormalRanges(null); // Clear new state
    setAdjustments(null);
    setError(null);
    setTestStripSystem('pool');
  };

  return (
    <TestStripContext.Provider
      value={{
        image,
        detectedReadings,
        padCoordinates, // Add to context value
        normalRanges, // Add to context value
        adjustments,
        isProcessing,
        error,
        testStripSystem,
        processImage, // Use the new backend-calling function
        clearState,
        setAdjustments, // Keep these setters if needed elsewhere
        setTestStripSystem
      }}
    >
      {children}
    </TestStripContext.Provider>
  );
}; 