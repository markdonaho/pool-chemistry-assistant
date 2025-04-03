import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [system, setSystem] = useState('cold_plunge');
  const [systemsData, setSystemsData] = useState(null);
  const [current, setCurrent] = useState({});
  const [results, setResults] = useState(null);

  // Fetch systems data on mount and when system changes
  useEffect(() => {
    axios.get('http://127.0.0.1:5000/systems')
      .then(res => {
        setSystemsData(res.data);
        // Initialize current readings with 0 for each field
        const targets = res.data[system].targets;
        setCurrent(Object.fromEntries(Object.keys(targets).map(k => [k, 0])));
      })
      .catch(err => console.error('Error fetching systems:', err));
  }, [system]);

  const handleSubmit = () => {
    axios.post('http://127.0.0.1:5000/calculate', { system, current })
      .then(res => setResults(res.data))
      .catch(err => console.error('Error calculating:', err));
  };

  const handleInputChange = (field, value) => {
    setCurrent({ ...current, [field]: parseFloat(value) || 0 });
  };

  if (!systemsData) return <div>Loading...</div>;

  return (
    <div className="App">
      <h1>Pool & Cold Plunge Chemistry Assistant</h1>
      <div>
        <label>Select System: </label>
        <select value={system} onChange={e => setSystem(e.target.value)}>
          <option value="cold_plunge">Cold Plunge</option>
          <option value="pool">Pool</option>
        </select>
      </div>
      <div>
        <h2>Enter Current Readings</h2>
        {Object.keys(systemsData[system].targets).map(field => (
          <div key={field} className="input-group">
            <label>{field} (Target: {systemsData[system].targets[field]}): </label>
            <input
              type="number"
              step="0.1"
              value={current[field]}
              onChange={e => handleInputChange(field, e.target.value)}
            />
          </div>
        ))}
      </div>
      <button onClick={handleSubmit}>Calculate Adjustments</button>
      {results && (
        <div>
          <h2>Adjustments</h2>
          {Object.entries(results.adjustments).map(([field, [amount, direction, chemical]]) => (
            amount !== 0 ? (
              <p key={field}>
                Add {amount.toFixed(2)}g of {chemical} to {field}
              </p>
            ) : (
              <p key={field}>{field} is on target</p>
            )
          ))}
          {results.shock && (
            <p>
              Add {results.shock.amount.toFixed(2)}g of {results.shock.chemical} (midweek treatment)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default App;