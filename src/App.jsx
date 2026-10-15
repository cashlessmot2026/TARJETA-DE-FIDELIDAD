import { useEffect, useState } from 'react'
import Customer from './Customer.jsx'
import Admin from './Admin.jsx'

const readRoute = () => window.location.hash.replace(/^#\/?/, '')

export default function App() {
  const [route, setRoute] = useState(readRoute())
  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // La ruta #/admin no está enlazada en ninguna parte de la interfaz del cliente.
  if (route.startsWith('admin')) return <Admin />
  return <Customer route={route} />
}
