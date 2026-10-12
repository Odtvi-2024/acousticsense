// Archivo principal de inicialización de AcousticSense FBQ-31
import { AudioEngine } from './audio-engine.js';
import { UIController } from './ui-controller.js';

function startApp() {
  try {
    const engine = new AudioEngine();
    const ui = new UIController(engine);

    // 1. Inicializar interfaz de usuario INMEDIATAMENTE de forma síncrona
    ui.init();

    // 2. Desbloqueo de AudioContext en el primer toque o clic
    const unlockAudio = async () => {
      try {
        await engine.resumeContext();
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      } catch (err) {
        console.warn('Esperando interacción para AudioContext:', err);
      }
    };

    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    // 3. Tareas secundarias de PWA (solo cuando se ejecuta bajo protocolo http/https)
    if (window.location.protocol.startsWith('http')) {
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => {
            if (key !== 'acousticsense-v2') caches.delete(key);
          });
        }).catch(() => {});
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
          .then((reg) => { if (reg) reg.update(); })
          .catch(() => {});
      }
    }
  } catch (err) {
    console.error('Error al inicializar AcousticSense:', err);
  }
}

// Ejecutar de forma segura: si el DOM ya cargó, iniciar de inmediato; si no, esperar DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
