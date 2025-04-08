const config = {
  apiUrl: process.env.REACT_APP_API_URL || 'https://us-central1-poolchemistryassistant.cloudfunctions.net',
  endpoints: {
    calculate: '/calculate',
  }
};

export default config; 