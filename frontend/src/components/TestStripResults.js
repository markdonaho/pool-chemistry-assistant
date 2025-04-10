import React, { useEffect, useState, useCallback } from 'react';
import { useTestStrip } from '../context/TestStripContext';
import { useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
import config from '../config';

const TestStripResults = () => {
  const { image, detectedReadings, adjustments, setAdjustments, error } = useTestStrip();
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
            system: 'pool',
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
  }, [detectedReadings, setAdjustments, navigate, auth]);

  const formatAdjustment = (adjustment) => {
    // Handle shock treatment object
    if (typeof adjustment === 'object' && adjustment !== null && 'amount' in adjustment && 'chemical' in adjustment) {
      return `Add ${adjustment.amount.toFixed(1)} oz of ${adjustment.chemical}`;
    }

    // Handle regular chemical adjustments array
    if (Array.isArray(adjustment)) {
      const [amount, direction, chemical] = adjustment;
      if (amount === 0) return "No adjustment needed";
      if (!direction) return "No adjustment needed";
      return `${direction === 'up' ? 'Add' : 'Reduce'} ${Math.abs(amount).toFixed(1)} oz of ${chemical}`;
    }

    // If the adjustment is an object with numeric properties (like pH, Total Alkalinity, etc.)
    if (typeof adjustment === 'object' && adjustment !== null) {
      // Extract the values from the object - we expect [amount, direction, chemical]
      const values = Object.values(adjustment);
      if (values.length === 3) {
        const [amount, direction, chemical] = values;
        if (amount === 0) return "No adjustment needed";
        if (!direction) return "No adjustment needed";
        return `${direction === 'up' ? 'Add' : 'Reduce'} ${Math.abs(amount).toFixed(1)} oz of ${chemical}`;
      }
    }

    // Fallback for any other format
    return "Unable to process adjustment";
  };

  const getRecommendationClass = (adjustment) => {
    // Handle shock treatment object
    if (typeof adjustment === 'object' && adjustment !== null && 'amount' in adjustment) {
      return adjustment.amount === 0 ? 'no-change' : 'needs-adjustment';
    }

    // Handle regular chemical adjustments array
    if (Array.isArray(adjustment)) {
      const [amount] = adjustment;
      return amount === 0 ? 'no-change' : 'needs-adjustment';
    }

    // Handle object with numeric properties
    if (typeof adjustment === 'object' && adjustment !== null) {
      const values = Object.values(adjustment);
      if (values.length > 0) {
        const amount = values[0];
        return amount === 0 ? 'no-change' : 'needs-adjustment';
      }
    }

    return '';
  };

  if (error) {
    return (
      <div className="test-strip-results">
        <h2>Error Processing Results</h2>
        <p className="error">{error}</p>
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
          <p>Calculating adjustments...</p>
        </div>
      ) : calculationError ? (
        <div className="error">
          <p>{calculationError}</p>
          <button onClick={() => navigate('/test-strip/upload')}>
            Try Again
          </button>
        </div>
      ) : adjustments ? (
        <>
          <div className="adjustments">
            <h3>Recommended Chemical Adjustments</h3>
            <table>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(adjustments)
                  .filter(([chemical]) => chemical !== 'shock')
                  .map(([parameter, adjustment]) => (
                    <tr key={parameter} className={getRecommendationClass(adjustment)}>
                      <td>{parameter}</td>
                      <td>{formatAdjustment(adjustment)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {adjustments.shock && (
            <div className="shock-treatment">
              <h3>Shock Treatment Needed</h3>
              <p>{formatAdjustment(adjustments.shock)}</p>
            </div>
          )}
        </>
      ) : null}

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