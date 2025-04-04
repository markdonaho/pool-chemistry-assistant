import React, { useState, useEffect, useRef, useMemo } from 'react';
import { functions, httpsCallable, auth } from './index';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import Auth from './Auth';
import './App.css';

function Picker({ value, onChange, target }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(value);
  const pickerRef = useRef(null);

  const increment = target >= 100 ? 5 : target >= 10 ? 1 : 0.1;
  let minValue, maxValue;
  if (target === 0) {
    minValue = 0;
    maxValue = 10;
  } else {
    minValue = Math.max(0, target * 0.5);
    maxValue = target * 2;
  }

  const values = useMemo(() => {
    const vals = [];
    for (let i = minValue; i <= maxValue; i += increment) {
      vals.push(parseFloat(i.toFixed(1)));
    }
    return vals;
  }, [minValue, maxValue, increment]);

  const closestValue = values.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  );

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
    const itemHeight = 40;
    const index = Math.round(container.scrollTop / itemHeight);
    const newValue = values[index] || closestValue;
    setSelectedValue(newValue);
  };

  const handleSelect = (val) => {
    onChange(val);
    setIsOpen(false);
  };

  const handleOutsideClick = (e) => {
    if (e.target.classList.contains('picker-modal')) {
      setIsOpen(false);
    }
  };

  const togglePicker = () => {
    setIsOpen(!isOpen);
    setSelectedValue(value);
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
  const [user, setUser] = useState(null);
  const [system, setSystem] = useState('cold_plunge');
  const [systemsData, setSystemsData] = useState(null);
  const [current, setCurrent] = useState({});
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Monitor authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Force token refresh and log it for debugging
        const token = await currentUser.getIdToken(true);
        console.log('User authenticated, ID token:', token);
      } else {
        console.log('No user authenticated');
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch systems data when user is authenticated
  useEffect(() => {
    if (user) {
      console.log('Fetching systems data for user:', user.uid);
      const getSystems = httpsCallable(functions, 'systems');
      getSystems()
        .then((result) => {
          console.log('Systems data fetched:', result.data);
          setSystemsData(result.data);
          const targets = result.data[system].targets;
          setCurrent(Object.fromEntries(Object.keys(targets).map(k => [k, targets[k]])));
        })
        .catch((err) => {
          console.error("Error fetching systems:", err);
          setError("Failed to load system data. Please try again later.");
        });
    }
  }, [system, user]);

  const handleSubmit = () => {
    setLoading(true);
    setError(null);
    setResults(null);
    const calculate = httpsCallable(functions, 'calculate');
    calculate({ system, current })
      .then((result) => {
        setResults(result.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error calculating:", err);
        setError("Failed to calculate adjustments. Please try again.");
        setLoading(false);
      });
  };

  const handleInputChange = (field, value) => {
    setCurrent({ ...current, [field]: parseFloat(value) });
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSystemsData(null);
      setCurrent({});
      setResults(null);
      setError(null);
    } catch (err) {
      setError("Failed to log out. Please try again.");
    }
  };

  // Show login/signup page if not authenticated
  if (!user) {
    return <Auth onLogin={(user) => setUser(user)} />;
  }

  // Show loading or error states
  if (error) return <div className="error">{error}</div>;
  if (!systemsData) return <div className="loading">Loading...</div>;

  // Main app content for authenticated users
  return (
    <div className="App $($)">
      <div className="header">
        <h1>Pool & Cold Plunge Chemistry Assistant</h1>
        <button onClick={handleLogout} className="logout-button">Log Out</button>
      </div>
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