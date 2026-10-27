import { useEffect, useState } from 'react'
import Customer from './Customer.jsx'
import Admin from './Admin.jsx'
import Super from './Super.jsx'

const readRoute = () => window.location.hash.replace(/^#\/?/, '')

export default function App() {
  const [route, setRoute] = useState(readRoute())
  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // #/super y #/admin no están enlazadas en ninguna parte de la interfaz del cliente.
  if (route.startsWith('super')) return <Super />
  const admin = route.match(/^admin(?:\/([a-z0-9-]+))?/i)
  if (admin) return <Admin key={admin[1] || ''} slug={admin[1]?.toLowerCase()} />
  return <Customer route={route} />
}
