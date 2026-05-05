# Region GeoJSON files

Polygons for AI model coverage zones rendered in the AI Models tab map.

## Source

Natural Earth Admin-0 country boundaries, 110m resolution (CC0 license).
Download: https://www.naturalearthdata.com/downloads/110m-cultural-vectors/

## Processing

Files are pre-processed (filtered to relevant countries, simplified with
mapshaper at ~5% retention) to keep bundle size small.

## Files

- `europe.geojson` — union of European country boundaries (excluding
  Russia east of the Urals; including Cyprus and Malta).
- `himalayas.geojson` — Kyrgyzstan boundary. Replace with a broader
  high-altitude Central Asian polygon if the model authors prefer.

## Updating

1. Download `ne_110m_admin_0_countries.geojson` from Natural Earth.
2. In mapshaper: filter by `CONTINENT == "Europe"` (or by ISO_A2 list),
   simplify to ~5%, export as GeoJSON, save as `europe.geojson`.
3. Repeat for Kyrgyzstan: `filter "ISO_A2 == 'KG'"`.
4. Verify the result loads in the map and looks correct.
