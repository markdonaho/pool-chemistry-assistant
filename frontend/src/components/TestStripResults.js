import React, { useEffect, useState, useCallback } from 'react';
import { useTestStrip } from '../context/TestStripContext';
import { useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
import config from '../config';

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

  // Function to format adjustments for display
  const formatAdjustment = (adjustment) => {
    // Handle Shock Object: { amount, unit, product }
    if (typeof adjustment === 'object' && adjustment !== null && 'amount' in adjustment && 'unit' in adjustment && 'product' in adjustment) {
      const amount = Number(adjustment.amount);
      if (isNaN(amount) || amount <= 0) return "No shock treatment needed";
      return `Add ${amount.toFixed(1)} ${adjustment.unit} of ${adjustment.product}`;
    }

    // Handle Chemical Adjustment Array: [amount, unit, direction, productName]
    if (Array.isArray(adjustment) && adjustment.length === 4) {
      const [amountValue, unit, direction, productName] = adjustment;
      const amount = Number(amountValue);

      // Check for invalid amount or no adjustment needed
      if (isNaN(amount) || amount <= 0 || !direction || !unit || !productName) {
        return "No adjustment needed";
      }
      
      // Format the recommendation string
      const action = direction === 'up' ? 'Add' : 'Reduce with'; // Using "Reduce with" might imply a specific product
      return `${action} ${amount.toFixed(1)} ${unit} of ${productName}`;
    }

    // Fallback for unexpected formats
    console.warn('Unexpected adjustment format received:', adjustment);
    return "Adjustment data unavailable";
  };

  // Function to determine CSS class based on adjustment
  const getRecommendationClass = (adjustment) => {
     // Handle Shock Object
     if (typeof adjustment === 'object' && adjustment !== null && 'amount' in adjustment) {
      const amount = Number(adjustment.amount);
      return isNaN(amount) || amount <= 0 ? 'no-change' : 'needs-adjustment';
    }

    // Handle Chemical Adjustment Array
    if (Array.isArray(adjustment) && adjustment.length === 4) {
      const [amountValue] = adjustment;
      const amount = Number(amountValue);
      return isNaN(amount) || amount <= 0 ? 'no-change' : 'needs-adjustment';
    }

    // Default for unexpected formats
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

      {/* Loading state */}
      {isCalculating ? (
        <div className="loading">
          <div className="spinner"></div>
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
            <div className="table-container"> {/* Ensure table is scrollable */} 
              <table>
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(adjustments.adjustments || {})
                    // Filter out entries where adjustment is null or indicates no action
                    .filter(([_, adjValue]) => adjValue && (Array.isArray(adjValue) ? Number(adjValue[0]) > 0 : false))
                    .map(([parameter, adjustmentValue]) => (
                      <tr key={parameter} className={getRecommendationClass(adjustmentValue)}>
                        <td>{parameter}</td>
                        <td>{formatAdjustment(adjustmentValue)}</td>
                      </tr>
                    ))}
                    {/* Add a row if no adjustments are needed */}
                    {Object.values(adjustments.adjustments || {}).every(adj => !adj || Number(adj[0]) <= 0) && (
                      <tr>
                        <td colSpan="2" style={{ textAlign: 'center', fontStyle: 'italic' }}>All parameters are within target range.</td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div> 
          </div>

          {/* Shock Treatment Section */}
          {adjustments.shock && Number(adjustments.shock.amount) > 0 && (
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