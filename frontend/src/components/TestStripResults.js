import React, { useEffect, useState } from 'react';
import { useTestStrip } from '../context/TestStripContext';
import { useNavigate } from 'react-router-dom';

const TestStripResults = () => {
  const { image, detectedReadings, adjustments, setAdjustments, error } = useTestStrip();
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationError, setCalculationError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!detectedReadings) {
      navigate('/test-strip/upload');
      return;
    }

    const calculateAdjustments = async () => {
      setIsCalculating(true);
      setCalculationError(null);

      try {
        const response = await fetch('https://us-central1-poolchemistryassistant.cloudfunctions.net/calculate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
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
  }, [detectedReadings, setAdjustments, navigate]);

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

      {image && (
        <div className="result-image">
          <img src={image} alt="Processed test strip" />
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
              {Object.entries(adjustments).map(([chemical, amount]) => (
                <tr key={chemical}>
                  <td>{chemical}</td>
                  <td>{amount}</td>
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