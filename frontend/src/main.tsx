import React from 'react'
import ReactDOM from 'react-dom/client'
import { Chat } from './index'
import './style.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Chat apiBase="/api" uploadUrl="/api/upload" />
  </React.StrictMode>,
)
