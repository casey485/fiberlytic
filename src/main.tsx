import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './i18n'
import { DataProvider } from './store/DataContext.tsx'
import { RoleProvider } from './store/RoleContext.tsx'
import { ThemeProvider } from './store/ThemeContext.tsx'
import { LocaleProvider } from './store/LocaleContext.tsx'
import { AuthProvider } from './store/AuthContext.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <LocaleProvider>
          <AuthProvider>
            <DataProvider>
              <RoleProvider>
                <App />
              </RoleProvider>
            </DataProvider>
          </AuthProvider>
        </LocaleProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
