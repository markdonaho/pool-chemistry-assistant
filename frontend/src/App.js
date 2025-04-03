import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import './App.css';

function Picker({ value, onChange, target }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(value); // Track the scrolled value locally
  const pickerRef = useRef(null);

  // Determine the range and increment based on the target
  const increment = target >= 100 ? 5 : target >= 10 ? 1 : 0.1;
  let minValue, maxValue;
  if (target === 0) {
    // Special case for target = 0 (e.g., Cyanuric Acid in cold_plunge)
    minValue = 0;
    maxValue = 10; // Allow scrolling up to 10
  } else {
    minValue = Math.max(0, target * 0.5); // Start at 50% of target
    maxValue = target * 2; // Allow up to 200% of target
  }

  // Use useMemo to memoize the values array
  const values = useMemo(() => {
    const vals = [];
    for (let i = minValue; i <= maxValue; i += increment) {
      vals.push(parseFloat(i.toFixed(1)));
    }
    return vals;
  }, [minValue, maxValue, increment]); // Dependencies that affect the values array

  // Find the closest value to the current value
  const closestValue = values.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  );

  // Scroll to the selected value when the picker opens
  useEffect(() => {
    if (isOpen && pickerRef.current) {
      const itemHeight = 40;
      const index = values.indexOf(selectedValue);
      if (index !== -1) {
        pickerRef.current.scrollTop = index * itemHeight;
      }
    }
  }, [isOpen, selectedValue, values]);

  const handleScroll = (e) => {
    const container = e.target;
    const itemHeight = 40; // Height of each item in the picker
    const index = Math.round(container.scrollTop / itemHeight);
    const newValue = values[index] || closestValue;
    setSelectedValue(newValue); // Update local state as the user scrolls
  };

  const handleSelect = (val) => {
    onChange(val); // Update the parent state with the selected value
    setIsOpen(false); // Close the picker
  };

  const handleOutsideClick = (e) => {
    if (e.target.classList.contains('picker-modal')) {
      setIsOpen(false); // Close the picker without saving
    }
  };

  const togglePicker = () => {
    setIsOpen(!isOpen);
    setSelectedValue(value); // Reset to the current value when opening
  };

  return (
    <div className="picker-container">
      <div className="picker-value" onClick={togglePicker}>
        {value.toFixed(1)}
      </div>
      {isOpen && (
        <div className={`picker-modal ${isOpen ? 'open' : ''}`} onClick={handleOutsideClick}>
          <div className="picker">
            <div className="picker-highlight" />
            <div className="picker-values" onScroll={handleScroll} ref={pickerRef}>
              {values.map((val, index) => (
                <div
                  key={index}
                  className={`picker-item ${val === selectedValue ? 'selected' : ''}`}
                  onClick={() => handleSelect(val)}
                >
                  {val.toFixed(1)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [system, setSystem] = useState('cold_plunge');
  const [systemsData, setSystemsData] = useState(null);
  const [current, setCurrent] = useState({});
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const SYSTEMS_URL = "https://systems-pjfngl6oca-uc.a.run.app";
  const CALCULATE_URL = "https://calculate-pjfngl6oca-uc.a.run.app"

  // Fetch systems data on mount and when system changes
  useEffect(() => {
    axios.get(SYSTEMS_URL)
      .then(res => {
        setSystemsData(res.data);
        const targets = res.data[system].targets;
        // Initialize current readings with the target value
        setCurrent(Object.fromEntries(Object.keys(targets).map(k => [k, targets[k]])));
      })
      .catch(err => {
        console.error('Error fetching systems:', err);
        setError('Failed to load system data. Please try again later.');
      });
  }, [system]);

  const handleSubmit = () => {
    setLoading(true);
    setError(null);
    setResults(null);
    axios.post(CALCULATE_URL, { system, current })
      .then(res => {
        setResults(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error calculating:', err);
        setError('Failed to calculate adjustments. Please try again.');
        setLoading(false);
      });
  };

  const handleInputChange = (field, value) => {
    setCurrent({ ...current, [field]: parseFloat(value) });
  };

  if (error) return <div className="error">{error}</div>;
  if (!systemsData) return <div className="loading">Loading...</div>;

  return (
    <div className="App">
      <h1>Pool & Cold Plunge Chemistry Assistant</h1>
      <div className="system-selector">
        <label>Select System: </label>
        <select value={system} onChange={e => setSystem(e.target.value)}>
          <option value="cold_plunge">Cold Plunge</option>
          <option value="pool">Pool</option>
        </select>
      </div>
      <div className="form-container">
        <h2>Enter Current Readings</h2>
        {Object.keys(systemsData[system].targets).map(field => (
          <div key={field} className="input-group">
            <label>{field} (Target: {systemsData[system].targets[field]}): </label>
            <Picker
              value={current[field]}
              onChange={value => handleInputChange(field, value)}
              target={systemsData[system].targets[field]}
            />
          </div>
        ))}
        <button onClick={handleSubmit} disabled={loading}>
          {loading ? 'Calculating...' : 'Calculate Adjustments'}
        </button>
      </div>
      {results && (
        <div className="results-container">
          <h2>Adjustments</h2>
          {Object.entries(results.adjustments).map(([field, [amount, direction, chemical]]) => (
            amount !== 0 ? (
              <div key={field} className="adjustment-card">
                <p>
                  Add <strong>{amount.toFixed(2)}g</strong> of <strong>{chemical}</strong> to {field}
                </p>
              </div>
            ) : (
              <div key={field} className="adjustment-card on-target">
                <p>{field} is on target</p>
              </div>
            )
          ))}
          {results.shock && (
            <div className="shock-card">
              <p>
                <strong>Shock Treatment:</strong> Add {results.shock.amount.toFixed(2)}g of{' '}
                {results.shock.chemical} (midweek treatment)
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;