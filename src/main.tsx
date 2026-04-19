// Import StrictMode from React to highlight potential problems in an application
import {StrictMode} from 'react';
// Import createRoot from react-dom/client to create a root to display React components inside a browser DOM node
import {createRoot} from 'react-dom/client';
// Import the main App component
import App from './App.tsx';
// Import the global CSS file containing Tailwind directives and custom styles
import './index.css';

// Create a React root for the element with the ID 'root' and render the application
createRoot(document.getElementById('root')!).render(
  // Wrap the App component in StrictMode for additional development checks and warnings
  <StrictMode>
    <App />
  </StrictMode>,
);
