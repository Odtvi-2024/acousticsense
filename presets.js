// ISO 266 Standard 1/3-Octave Frequencies for 31-Band Equalizer
export const ISO_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
];

export const ISO_LABELS = [
  '20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160',
  '200', '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k',
  '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k'
];

export const PRESETS = {
  flat: {
    name: 'Plano (Flat / Bypass)',
    description: 'Respuesta plana sin alteración de ganancia',
    lowCut: 10,
    highCut: 30000,
    inputGain: 0,
    gains: new Array(31).fill(0)
  },
  vShapeClear: {
    name: '✨ Curva en V (Bajos y Agudos Claros)',
    description: 'Pegada sólida de graves, medios limpios sin barro y agudos cristalinos con aire',
    lowCut: 32,
    highCut: 28000,
    inputGain: -1.5,
    gains: [
      0.0, 1.0, 2.0, 3.0, 4.0, 4.5, 3.5, 2.0, 1.0, 0.0,
      -1.5, -2.5, -3.0, -2.0, -1.0, 0.0, 0.0, 0.0, 0.5, 1.0,
      1.5, 2.0, 2.5, 3.0, 3.5, 2.5, 3.5, 4.5, 5.0, 4.5, 3.0
    ]
  },
  bassBoost: {
    name: 'Refuerzo de Graves (Bass Boost)',
    description: 'Potencia frecuencias subgraves y bombos',
    lowCut: 20,
    highCut: 25000,
    inputGain: -2,
    gains: [6, 6, 5.5, 5, 4, 3, 2, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  rock: {
    name: 'Rock / Curva Sonrisa (V-Shape)',
    description: 'Graves sólidos y agudos brillantes con medios limpios',
    lowCut: 25,
    highCut: 22000,
    inputGain: -1,
    gains: [4.5, 4, 3.5, 3, 2, 1, 0, -1, -2, -2.5, -3, -2.5, -2, -1, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5, 4.5, 4, 3.5, 3, 2]
  },
  vocalClarity: {
    name: 'Claridad Vocal (Vocal / Discurso)',
    description: 'Reduce resonancias graves y resalta inteligibilidad de la voz',
    lowCut: 80,
    highCut: 18000,
    inputGain: 0,
    gains: [-8, -6, -4, -3, -2, -1, 0, 0, -1, -2, -2.5, -2, -1, 0, 1, 2, 2.5, 3, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0, 0, -1, -2, -3, -4]
  },
  clubEdm: {
    name: 'Club / Electrónica (EDM Punch)',
    description: 'Golpe seco de 50-80Hz y agudos cristalinos para música electrónica',
    lowCut: 25,
    highCut: 24000,
    inputGain: -2,
    gains: [5, 6, 6.5, 6, 5, 3, 1, -1, -2, -2, -1, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 5, 4, 3, 2]
  },
  acoustic: {
    name: 'Guitarra Acústica & En vivo',
    description: 'Corta frecuencias retumbantes de caja y realza armónicos',
    lowCut: 50,
    highCut: 20000,
    inputGain: 0,
    gains: [-6, -5, -4, -3, -2, -1, 0, 0.5, 0, -2, -3, -2.5, -1, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3, 2.5, 2, 1.5, 1, 0.5, 0, 0, 0, 0, 0]
  },
  antiFeedback: {
    name: 'Supresor de Acoples (Anti-Feedback)',
    description: 'Atenúa bandas críticas comunes de retroalimentación en microfonía en vivo',
    lowCut: 40,
    highCut: 16000,
    inputGain: 0,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, -2, -4, -2, 0, -3, -6, -3, 0, 0, -3, -5, -2, 0, -4, -7, -3, 0, -2, -5, -2, 0, 0, 0]
  },
  radioBroadcast: {
    name: 'Locución / Radio Broadcast',
    description: 'Efecto de presencia cálida con cuerpo y compresión tímbrica para podcast y streaming',
    lowCut: 60,
    highCut: 16000,
    inputGain: 0,
    gains: [-4, -3, -1, 1, 2.5, 3, 2, 1, 0, -1, -2, -2, -1, 0, 1, 2, 3, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0, 0, -1, -2, -3, -4, -5]
  }
};
