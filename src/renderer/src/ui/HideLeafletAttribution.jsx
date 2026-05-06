import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

export default function HideLeafletAttribution() {
  const map = useMap()
  useEffect(() => {
    map.attributionControl?.setPrefix(false)
  }, [map])
  return null
}
