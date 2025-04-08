import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTestStrip } from '../context/TestStripContext';
import heic2any from 'heic2any';

const TestStripUpload = () => {
  const navigate = useNavigate();
  const { processImage, setDetectedReadings, isProcessing: contextIsProcessing } = useTestStrip();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [processedFile, setProcessedFile] = useState(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualReadings, setManualReadings] = useState({
    'Total Hardness': '',
    'Total Chlorine': '',
    'Free Chlorine': '',
    'Bromine': '',
    'Total Alkalinity': '',
    'Cyanuric Acid': '',
    'pH': ''
  });

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setShowManualInput(false);

    try {
      let imageToProcess = file;
      let previewFile = file;

      // Handle HEIC files
      if (file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic')) {
        try {
          const convertedBlob = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.8
          });
          imageToProcess = new File([convertedBlob], file.name.replace('.heic', '.jpg'), {
            type: 'image/jpeg'
          });
          previewFile = imageToProcess;
        } catch (conversionError) {
          throw new Error('Failed to convert HEIC image. Please try uploading a JPEG or PNG file instead.');
        }
      }

      // Store the processed file
      setProcessedFile(imageToProcess);

      // Create preview URL
      const objectUrl = URL.createObjectURL(previewFile);
      setPreviewUrl(objectUrl);

      // Clean up the old preview URL when component unmounts
      return () => URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err.message || 'Failed to process image');
      console.error('Error handling file:', err);
      setProcessedFile(null);
      setShowManualInput(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    if (showManualInput) {
      // Handle manual input submission
      try {
        const readings = Object.fromEntries(
          Object.entries(manualReadings)
            .map(([key, value]) => [key, parseFloat(value)])
            .filter(([_, value]) => !isNaN(value))
        );

        if (Object.keys(readings).length === 0) {
          throw new Error('Please enter at least one valid reading');
        }

        setDetectedReadings(readings);
        navigate('/test-strip/results');
      } catch (err) {
        setError(err.message || 'Failed to process manual readings');
        console.error('Error processing manual readings:', err);
      }
    } else {
      // Handle image processing
      if (!processedFile) {
        setError('Please select an image first');
        return;
      }

      try {
        await processImage(processedFile);
        navigate('/test-strip/results');
      } catch (err) {
        setError(err.message || 'Failed to process image');
        console.error('Error processing image:', err);
        // Automatically show manual input after image processing failure
        setShowManualInput(true);
        // Pre-fill any successfully detected readings
        if (err.partialReadings) {
          setManualReadings(prev => ({
            ...prev,
            ...err.partialReadings
          }));
        }
      }
    }
    setIsLoading(false);
  };

  const handleManualInputChange = (parameter, value) => {
    setManualReadings(prev => ({
      ...prev,
      [parameter]: value
    }));
  };

  return (
    <div className="upload-container">
      <h2>Upload Test Strip Image</h2>
      
      <div className="guidelines">
        <p>Please follow these guidelines for best results:</p>
        <ul>
          <li>Place the test strip on a white background</li>
          <li>Ensure good lighting conditions</li>
          <li>Take the photo from directly above the strip</li>
          <li>Make sure the strip is fully visible in the frame</li>
          <li>Align the test strip vertically in the center of the image</li>
        </ul>
      </div>

      <form onSubmit={handleSubmit}>
        {!showManualInput && (
          <div className="file-input-container">
            <input
              type="file"
              accept="image/*,.heic"
              onChange={handleFileChange}
              className="file-input"
            />
          </div>
        )}

        {isLoading && (
          <div className="loading">
            <p>Processing image...</p>
          </div>
        )}

        {error && (
          <div className="error">
            <p>{error}</p>
            {!showManualInput && (
              <button
                type="button"
                onClick={() => setShowManualInput(true)}
                className="fallback-button"
              >
                Enter Readings Manually
              </button>
            )}
          </div>
        )}

        {previewUrl && !showManualInput && (
          <div className="preview-container">
            <img src={previewUrl} alt="Test strip preview" className="preview-image" />
          </div>
        )}

        {showManualInput && (
          <div className="manual-input-container">
            <h3>Enter Test Strip Readings Manually</h3>
            <div className="manual-input-grid">
              {Object.entries(manualReadings).map(([parameter, value]) => (
                <div key={parameter} className="input-group">
                  <label htmlFor={parameter}>{parameter}:</label>
                  <input
                    type="number"
                    id={parameter}
                    value={value}
                    onChange={(e) => handleManualInputChange(parameter, e.target.value)}
                    step="0.1"
                    min="0"
                    placeholder="Enter value"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || (!showManualInput && !previewUrl)}
          className="process-button"
        >
          {showManualInput ? 'Submit Readings' : 'Process Image'}
        </button>

        {showManualInput && (
          <button
            type="button"
            onClick={() => {
              setShowManualInput(false);
              setError(null);
              setManualReadings({
                'Total Hardness': '',
                'Total Chlorine': '',
                'Free Chlorine': '',
                'Bromine': '',
                'Total Alkalinity': '',
                'Cyanuric Acid': '',
                'pH': ''
              });
            }}
            className="switch-mode-button"
          >
            Try Image Upload Instead
          </button>
        )}
      </form>
    </div>
  );
};

export default TestStripUpload; 