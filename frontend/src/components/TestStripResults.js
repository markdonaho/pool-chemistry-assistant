import React, { useEffect, useState } from 'react';
import { useTestStrip } from '../context/TestStripContext';
import { useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';

const TestStripResults = () => {
  const { image, detectedReadings, adjustments, setAdjustments, error } = useTestStrip();
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationError, setCalculationError] = useState(null);
  const [localImageUrl, setLocalImageUrl] = useState(null);
  const navigate = useNavigate();
  const auth = getAuth();

  // Handle image URL
  useEffect(() => {
    if (image instanceof Blob) {
      const url = URL.createObjectURL(image);
      setLocalImageUrl(url);
      return () => URL.revokeObjectURL(url);
    } else if (typeof image === 'string') {
      setLocalImageUrl(image);
    }
  }, [image]);

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
        const response = await fetch('https://us-central1-poolchemistryassistant.cloudfunctions.net/calculate', {
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

  const renderAdjustmentValue = (value) => {
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return value;
  };

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
                <td>{renderAdjustmentValue(value)}</td>
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
        <div className="adjustments">
          <h3>Recommended Adjustments</h3>
          <table>
            <thead>
              <tr>
                <th>Chemical</th>
                <th>Amount</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(adjustments).map(([chemical, adjustment]) => (
                <tr key={chemical}>
                  <td>{chemical}</td>
                  <td>{renderAdjustmentValue(adjustment)}</td>
                  <td>oz</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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