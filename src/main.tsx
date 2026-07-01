import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { DataProvider } from './store/DataContext.tsx'
import { RoleProvider } from './store/RoleContext.tsx'
import { ThemeProvider } from './store/ThemeContext.tsx'
import { AuthProvider } from './store/AuthContext.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <DataProvider>
            <RoleProvider>
              <App />
            </RoleProvider>
          </DataProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
