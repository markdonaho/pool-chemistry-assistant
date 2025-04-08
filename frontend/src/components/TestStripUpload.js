import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTestStrip } from '../context/TestStripContext';
import heic2any from 'heic2any';

const TestStripUpload = () => {
  const navigate = useNavigate();
  const { processImage } = useTestStrip();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [processedFile, setProcessedFile] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

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
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!processedFile) {
      setError('Please select an image first');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      await processImage(processedFile);
      navigate('/test-strip/results');
    } catch (err) {
      setError(err.message || 'Failed to process image');
      console.error('Error processing image:', err);
    } finally {
      setIsLoading(false);
    }
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
        </ul>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="file-input-container">
          <input
            type="file"
            accept="image/*,.heic"
            onChange={handleFileChange}
            className="file-input"
          />
        </div>

        {isLoading && (
          <div className="loading">
            <p>Processing image...</p>
          </div>
        )}

        {error && (
          <div className="error">
            <p>{error}</p>
          </div>
        )}

        {previewUrl && (
          <div className="preview-container">
            <img src={previewUrl} alt="Test strip preview" className="preview-image" />
          </div>
        )}

        <button
          type="submit"
          disabled={!previewUrl || isLoading}
          className="process-button"
        >
          Process Image
        </button>
      </form>
    </div>
  );
};

export default TestStripUpload; 