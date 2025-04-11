import React, { useEffect, useState, useCallback } from 'react';
import { useTestStrip } from '../context/TestStripContext';
import { useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
import config from '../config';
import { formatAdjustment, getRecommendationClass } from '../utils/formatUtils';

const TestStripResults = () => {
  const { image, detectedReadings, adjustments, setAdjustments, error, testStripSystem } = useTestStrip();
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationError, setCalculationError] = useState(null);
  const [localImageUrl, setLocalImageUrl] = useState(null);
  const navigate = useNavigate();
  const auth = getAuth();

  // Create blob URL
  const createBlobUrl = useCallback((imageData) => {
    if (imageData instanceof Blob) {
      return URL.createObjectURL(imageData);
    }
    return imageData;
  }, []);

  // Cleanup blob URL
  const cleanupBlobUrl = useCallback((url) => {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }, []);

  // Handle image URL
  useEffect(() => {
    let currentUrl = null;

    if (image) {
      currentUrl = createBlobUrl(image);
      setLocalImageUrl(currentUrl);
    }

    return () => {
      if (currentUrl) {
        cleanupBlobUrl(currentUrl);
      }
    };
  }, [image, createBlobUrl, cleanupBlobUrl]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (localImageUrl) {
        cleanupBlobUrl(localImageUrl);
      }
    };
  }, [localImageUrl, cleanupBlobUrl]);

  useEffect(() => {
    if (!detectedReadings) {
      navigate('/test-strip/upload');
      return;
    }

    const calculateAdjustments = async () => {
      setIsCalculating(true);
      setCalculationError(null);

      try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(`${config.apiUrl}${config.endpoints.calculate}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            system: testStripSystem,
            current: detectedReadings
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to calculate adjustments: ${errorText}`);
        }

        const result = await response.json();
        setAdjustments(result);
      } catch (err) {
        console.error('Error calculating adjustments:', err);
        setCalculationError(err.message);
      } finally {
        setIsCalculating(false);
      }
    };

    calculateAdjustments();
  }, [detectedReadings, setAdjustments, navigate, auth, testStripSystem]);

  if (calculationError || error) {
    return (
      <div className="test-strip-results">
        <h2>Error Processing Results</h2>
        <p className="error">{calculationError || error}</p>
        <button onClick={() => navigate('/test-strip/upload')}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="test-strip-results">
      <h2>Test Strip Results</h2>

      {localImageUrl && (
        <div className="result-image">
          <img src={localImageUrl} alt="Processed test strip" />
        </div>
      )}

      <div className="readings">
        <h3>Detected Readings</h3>
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {detectedReadings && Object.entries(detectedReadings).map(([parameter, value]) => (
              <tr key={parameter}>
                <td>{parameter}</td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isCalculating ? (
        <div className="loading">
          <div className="spinner"></div>
          <p>Calculating adjustments...</p>
        </div>
      ) : adjustments ? (
        <>
          <div className="adjustments">
            <h3>Recommended Chemical Adjustments</h3>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(adjustments.adjustments || {})
                    .filter(([_, adjValue]) => adjValue && (Array.isArray(adjValue) ? Number(adjValue[0]) > 0 : false))
                    .map(([parameter, adjustmentValue]) => (
                      <tr key={parameter} className={getRecommendationClass(adjustmentValue)}>
                        <td>{parameter}</td>
                        <td>{formatAdjustment(adjustmentValue)}</td>
                      </tr>
                    ))}
                  {Object.values(adjustments.adjustments || {}).every(adj => !adj || Number(adj[0]) <= 0) && (
                    <tr>
                      <td colSpan="2" style={{ textAlign: 'center', fontStyle: 'italic' }}>All parameters are within target range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div> 
          </div>

          {adjustments.shock && Number(adjustments.shock.amount) > 0 && (
            <div className="shock-treatment">
              <h3>Shock Treatment Needed</h3>
              <p>{formatAdjustment(adjustments.shock)}</p>
            </div>
          )}
        </>
      ) : (
        !calculationError && <div className="loading"><p>Waiting for calculations...</p></div>
      )}

      <div className="actions">
        <button onClick={() => navigate('/test-strip/upload')}>
          Upload Another Test Strip
        </button>
        <button onClick={() => navigate('/')}>
          Return to Dashboard
        </button>
      </div>
    </div>
  );
};

export default TestStripResults; 