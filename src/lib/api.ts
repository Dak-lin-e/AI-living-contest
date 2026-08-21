const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
export const api = (path: string, init?: RequestInit) =>
  fetch(`${API_BASE}/api/${path.replace(/^\/+/, '')}`, init)
