/* Regional geography for the mission view: simplified coastlines of the Arabian Gulf,
   Strait of Hormuz and Gulf of Oman, as [longitude, latitude] pairs. Schematic, not survey grade. */

export const WATER = [[48.5,30.0],[48.9,30.02],[49.3,30.1],[49.6,30.0],[50.16,30.05],[50.45,29.65],[50.68,29.3],[50.83,28.96],[51.05,28.6],[51.4,28.15],[51.93,27.84],[52.4,27.66],[52.62,27.47],[53.2,27.08],[53.9,26.76],[54.4,26.6],[54.88,26.56],[55.3,26.7],[55.6,26.95],[56.0,27.1],[56.3,27.18],[56.75,27.12],[57.0,26.85],[57.15,26.35],[57.3,25.95],[57.55,25.72],[57.78,25.65],[58.4,25.58],[59.2,25.42],[59.9,25.36],[60.6,25.3],[61.2,25.25],[63,25.3],[65,25.3],[66.6,25.4],[68.5,24.7],[68.5,14.5],[50,14.5],[52.2,16.0],[54.1,17.0],[55.5,17.8],[56.8,18.8],[57.8,19.6],[58.8,20.6],[59.5,21.6],[59.8,22.52],[59.52,22.57],[58.92,23.26],[58.59,23.62],[58.18,23.68],[57.88,23.71],[57.44,23.85],[56.75,24.36],[56.47,24.75],[56.36,25.12],[56.36,25.35],[56.28,25.62],[56.42,25.95],[56.38,26.38],[56.24,26.2],[56.08,26.03],[55.95,25.8],[55.56,25.56],[55.39,25.36],[55.26,25.23],[55.03,25.02],[54.76,24.86],[54.38,24.5],[54.0,24.24],[53.5,24.13],[52.72,24.12],[52.2,24.1],[51.76,24.03],[51.38,24.6],[51.6,24.98],[51.54,25.3],[51.5,25.68],[51.56,25.92],[51.22,26.16],[51.02,25.98],[50.87,25.66],[50.78,25.42],[50.82,24.95],[50.75,24.68],[50.5,24.9],[50.3,25.3],[50.22,25.62],[50.2,26.05],[50.22,26.28],[50.1,26.46],[50.16,26.66],[49.82,26.86],[49.66,27.02],[49.3,27.42],[48.62,28.1],[48.5,28.42],[48.38,28.75],[48.12,29.05],[47.98,29.37],[47.85,29.48],[48.05,29.58],[48.25,29.78],[48.4,29.95]];

/* Coastline only (the water outline without the open-sea edges), for drawing crisp shore lines. */
export const COAST_SEGMENTS = [
  WATER.slice(0, WATER.findIndex(p => p[0] === 68.5 && p[1] === 24.7) + 1),
  WATER.slice(WATER.findIndex(p => p[0] === 50 && p[1] === 14.5)).concat([WATER[0]])
];

export const BAHRAIN = [[50.45,26.25],[50.62,26.24],[50.64,26.05],[50.57,25.8],[50.46,25.96]];
export const QESHM = [[55.3,26.6],[55.75,26.82],[56.28,26.97],[56.18,26.72],[55.75,26.62],[55.4,26.52]];

/* [label, phrase, lat, lon] used to name the area under the satellite. */
export const PLACES = [
  ['Southern Iran', 'over southern Iran', 29.6, 57.3],
  ['Bandar Abbas', 'near Bandar Abbas', 27.18, 56.3],
  ['Strait of Hormuz', 'over the Strait of Hormuz', 26.55, 56.45],
  ['Musandam', 'over Musandam', 26.1, 56.25],
  ['Khor Fakkan', 'off Khor Fakkan', 25.35, 56.36],
  ['Fujairah', 'off Fujairah', 25.12, 56.36],
  ['Sohar', 'near Sohar', 24.35, 56.75],
  ['Al Ain', 'over Al Ain', 24.2, 55.75],
  ['Hajar Mountains', 'over the Hajar Mountains', 23.6, 56.0],
  ['Rub’ al Khali', 'over the Rub’ al Khali', 22.6, 55.4],
  ['Abu Dhabi', 'over Abu Dhabi', 24.45, 54.4],
  ['Dubai', 'over Dubai', 25.2, 55.27]
];

export function placeOf(lat, lon) {
  let best = PLACES[0], bd = Infinity;
  for (const p of PLACES) {
    const d = (p[2] - lat) ** 2 + ((p[3] - lon) * 0.9) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return bd < 4 ? best : ['Bench test', 'at the test bench', lat, lon];
}

/* Map labels for the 3D view: [text, lat, lon, style]. */
export const MAP_LABELS = [
  ['Arabian Gulf', 27.0, 51.6, 'sea'], ['Gulf of Oman', 24.3, 58.8, 'sea'], ['Strait of Hormuz', 26.95, 57.1, 'sea-s'],
  ['Arabian Sea', 20.0, 62.5, 'sea'], ['IRAN', 30.4, 54.5, 'cty'], ['UAE', 23.35, 54.0, 'cty'], ['OMAN', 21.2, 56.9, 'cty'],
  ['SAUDI ARABIA', 24.2, 46.6, 'cty'], ['QATAR', 25.35, 51.2, 'cty-s'],
  ['Abu Dhabi', 24.47, 54.37, 'city'], ['Dubai', 25.2, 55.27, 'city'], ['Khor Fakkan', 25.35, 56.36, 'city']
];

export const GROUND_STATION = { name: 'Ground station · Al Ain', lat: 24.2, lon: 55.75 };
