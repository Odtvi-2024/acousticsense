// Controlador de Interfaz de Usuario para el Ecualizador Ultragraph Pro FBQ
import { ISO_FREQUENCIES, ISO_LABELS, PRESETS } from './presets.js';

export class UIController {
  constructor(audioEngine) {
    this.engine = audioEngine;
    this.presets = { ...PRESETS };
    this.loadCustomPresets();

    // Referencias DOM
    this.fadersCh1 = [];
    this.fadersCh2 = [];
    this.metersCh1 = [];
    this.metersCh2 = [];

    // Estado de vista móvil y Playlist
    this.activeMobileTab = 'both'; // 'ch1', 'ch2', 'both'
    this.playlist = [];
    this.currentTrackIndex = -1;

    // Umbrales para el Vúmetro LED de 12 segmentos (dBFS)
    this.meterThresholds = [
      { db: -30, color: 'green' },
      { db: -24, color: 'green' },
      { db: -18, color: 'green' },
      { db: -12, color: 'green' },
      { db: -6,  color: 'green' },
      { db: -3,  color: 'green' },
      { db: 0,   color: 'green' },
      { db: 3,   color: 'amber' },
      { db: 6,   color: 'amber' },
      { db: 9,   color: 'amber' },
      { db: 12,  color: 'red' },
      { db: 15,  color: 'red', clip: true }
    ];
  }

  init() {
    this.buildFaders(0, 'faders-ch1', this.fadersCh1);
    this.buildFaders(1, 'faders-ch2', this.fadersCh2);
    this.buildMeters(0, 'meter-ch1', this.metersCh1);
    this.buildMeters(1, 'meter-ch2', this.metersCh2);

    this.bindKnobs();
    this.bindButtons();
    this.bindAudioSourceControls();
    this.bindPresets();
    this.bindModals();
    this.bindMobileTabs();

    // Iniciar bucle visual 60 FPS
    this.startRenderLoop();
  }

  // --- Construcción Dinámica de Faders de 31 Bandas ---
  buildFaders(channelIndex, containerId, faderArray) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    ISO_FREQUENCIES.forEach((freq, bandIndex) => {
      const slot = document.createElement('div');
      slot.className = 'fader-slot';
      slot.dataset.band = bandIndex;
      slot.dataset.channel = channelIndex;

      // Etiqueta de frecuencia superior
      const label = document.createElement('div');
      label.className = 'freq-label-top';
      label.textContent = ISO_LABELS[bandIndex];

      // Contenedor de recorrido del deslizador
      const trackContainer = document.createElement('div');
      trackContainer.className = 'fader-track-container';

      const trackSlot = document.createElement('div');
      trackSlot.className = 'fader-track-slot';

      const zeroLine = document.createElement('div');
      zeroLine.className = 'zero-db-line';
      trackSlot.appendChild(zeroLine);

      // Manilla con LED FBQ incorporado
      const handle = document.createElement('div');
      handle.className = 'fader-handle';
      handle.style.top = '50%'; // Posición 0 dB por defecto

      const ledPip = document.createElement('div');
      ledPip.className = 'fader-led-pip';
      handle.appendChild(ledPip);

      trackContainer.appendChild(trackSlot);
      trackContainer.appendChild(handle);

      // Indicador de valor de ganancia inferior
      const valueText = document.createElement('div');
      valueText.className = 'fader-gain-value';
      valueText.textContent = '0.0';

      slot.appendChild(label);
      slot.appendChild(trackContainer);
      slot.appendChild(valueText);
      container.appendChild(slot);

      const faderObj = {
        bandIndex,
        channelIndex,
        handle,
        ledPip,
        valueText,
        trackContainer,
        currentDb: 0
      };

      faderArray.push(faderObj);
      this.attachFaderEvents(faderObj);
    });
  }

  attachFaderEvents(faderObj) {
    const { trackContainer, handle, channelIndex, bandIndex } = faderObj;
    let isDragging = false;

    const updateFaderFromY = (clientY, fineTune = false) => {
      const rect = trackContainer.getBoundingClientRect();
      const clampedY = Math.max(rect.top, Math.min(rect.bottom, clientY));
      const normalized = 1 - ((clampedY - rect.top) / rect.height); // 0 abajo, 1 arriba

      const range = this.engine.rangeMode;
      let targetDb = (normalized - 0.5) * 2 * range;

      // Ajuste fino o paso normal
      if (fineTune) {
        targetDb = Math.round(targetDb * 10) / 10;
      } else {
        targetDb = Math.round(targetDb * 2) / 2; // pasos de 0.5 dB
      }
      targetDb = Math.max(-range, Math.min(range, targetDb));

      this.setFaderDb(channelIndex, bandIndex, targetDb, true);
    };

    trackContainer.addEventListener('pointerdown', (e) => {
      isDragging = true;
      trackContainer.setPointerCapture(e.pointerId);
      updateFaderFromY(e.clientY, e.shiftKey);
    });

    trackContainer.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      updateFaderFromY(e.clientY, e.shiftKey);
    });

    const stopDrag = (e) => {
      if (isDragging) {
        isDragging = false;
        try { trackContainer.releasePointerCapture(e.pointerId); } catch (err) {}
      }
    };

    trackContainer.addEventListener('pointerup', stopDrag);
    trackContainer.addEventListener('pointercancel', stopDrag);

    // Doble clic para reiniciar a 0 dB
    trackContainer.addEventListener('dblclick', () => {
      this.setFaderDb(channelIndex, bandIndex, 0, true);
    });

    // Rueda del ratón para ajuste preciso
    trackContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.5 : -0.5;
      const newDb = Math.max(-this.engine.rangeMode, Math.min(this.engine.rangeMode, faderObj.currentDb + delta));
      this.setFaderDb(channelIndex, bandIndex, newDb, true);
    }, { passive: false });
  }

  setFaderDb(channelIndex, bandIndex, db, updateEngine = true) {
    const range = this.engine.rangeMode;
    const clampedDb = Math.max(-range, Math.min(range, db));
    const normalized = (clampedDb / (2 * range)) + 0.5; // 0 a 1
    const topPercent = (1 - normalized) * 100;

    const applyToFader = (fader) => {
      fader.currentDb = clampedDb;
      fader.handle.style.top = `${topPercent}%`;
      fader.valueText.textContent = clampedDb === 0 ? '0.0' : (clampedDb > 0 ? `+${clampedDb.toFixed(1)}` : clampedDb.toFixed(1));
    };

    if (this.engine.stereoLink) {
      if (this.fadersCh1[bandIndex]) applyToFader(this.fadersCh1[bandIndex]);
      if (this.fadersCh2[bandIndex]) applyToFader(this.fadersCh2[bandIndex]);
    } else {
      const arr = channelIndex === 0 ? this.fadersCh1 : this.fadersCh2;
      if (arr[bandIndex]) applyToFader(arr[bandIndex]);
    }

    if (updateEngine) {
      this.engine.setBandGain(channelIndex, bandIndex, clampedDb);
    }
  }

  // --- Construcción de Vúmetros LED ---
  buildMeters(channelIndex, containerId, meterArray) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const barGraph = document.createElement('div');
    barGraph.className = 'led-bar-graph';

    this.meterThresholds.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'meter-row';

      const label = document.createElement('span');
      label.className = 'meter-label';
      label.textContent = item.clip ? 'CLIP' : (item.db > 0 ? `+${item.db}` : `${item.db}`);

      const led = document.createElement('div');
      led.className = `meter-led ${item.color}`;

      row.appendChild(label);
      row.appendChild(led);
      barGraph.appendChild(row);

      meterArray.push({ led, db: item.db, clip: item.clip });
    });

    container.appendChild(barGraph);
  }

  // --- Controles de Perillas Rotativas (Knobs) ---
  bindKnobs() {
    this.setupRotaryKnob('knob-in-ch1', (val) => {
      this.engine.setInputGain(0, val);
      document.getElementById('val-in-ch1').textContent = `${val > 0 ? '+' : ''}${val.toFixed(1)}dB`;
      if (this.engine.stereoLink) {
        this.updateKnobAngle('knob-in-ch2', val, -12, 12);
        document.getElementById('val-in-ch2').textContent = `${val > 0 ? '+' : ''}${val.toFixed(1)}dB`;
      }
    }, -12, 12, 0);

    this.setupRotaryKnob('knob-in-ch2', (val) => {
      this.engine.setInputGain(1, val);
      document.getElementById('val-in-ch2').textContent = `${val > 0 ? '+' : ''}${val.toFixed(1)}dB`;
    }, -12, 12, 0);

    this.setupRotaryKnob('knob-lc-ch1', (val) => {
      this.engine.setLowCut(0, val);
      document.getElementById('val-lc-ch1').textContent = `${Math.round(val)}Hz`;
      if (this.engine.stereoLink) {
        this.updateKnobAngle('knob-lc-ch2', val, 10, 400);
        document.getElementById('val-lc-ch2').textContent = `${Math.round(val)}Hz`;
      }
    }, 10, 400, 10);

    this.setupRotaryKnob('knob-lc-ch2', (val) => {
      this.engine.setLowCut(1, val);
      document.getElementById('val-lc-ch2').textContent = `${Math.round(val)}Hz`;
    }, 10, 400, 10);

    this.setupRotaryKnob('knob-hc-ch1', (val) => {
      this.engine.setHighCut(0, val);
      document.getElementById('val-hc-ch1').textContent = val >= 1000 ? `${(val/1000).toFixed(1)}k` : `${Math.round(val)}Hz`;
      if (this.engine.stereoLink) {
        this.updateKnobAngle('knob-hc-ch2', val, 2500, 32000);
        document.getElementById('val-hc-ch2').textContent = val >= 1000 ? `${(val/1000).toFixed(1)}k` : `${Math.round(val)}Hz`;
      }
    }, 2500, 32000, 30000);

    this.setupRotaryKnob('knob-hc-ch2', (val) => {
      this.engine.setHighCut(1, val);
      document.getElementById('val-hc-ch2').textContent = val >= 1000 ? `${(val/1000).toFixed(1)}k` : `${Math.round(val)}Hz`;
    }, 2500, 32000, 30000);

    // Controles de Subwoofer
    this.setupRotaryKnob('knob-sub-freq', (val) => {
      const level = parseFloat(document.getElementById('val-sub-level').dataset.val || '0');
      const muted = document.getElementById('btn-sub-mute').classList.contains('active');
      this.engine.setSubwooferParams(val, level, muted);
      document.getElementById('val-sub-freq').textContent = `${Math.round(val)}Hz`;
    }, 30, 200, 80);

    this.setupRotaryKnob('knob-sub-level', (val) => {
      const freq = parseFloat(document.getElementById('val-sub-freq').dataset.val || '80');
      const muted = document.getElementById('btn-sub-mute').classList.contains('active');
      document.getElementById('val-sub-level').dataset.val = val;
      this.engine.setSubwooferParams(freq, val, muted);
      document.getElementById('val-sub-level').textContent = `${val > 0 ? '+' : ''}${val.toFixed(1)}dB`;
    }, -12, 12, 0);
  }

  setupRotaryKnob(elementId, onChange, min, max, initial) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let currentValue = initial;
    let startY = 0;
    let isDragging = false;

    const setVal = (v) => {
      currentValue = Math.max(min, Math.min(max, v));
      this.updateKnobAngle(elementId, currentValue, min, max);
      onChange(currentValue);
    };

    el.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const deltaY = startY - e.clientY;
      startY = e.clientY;
      const range = max - min;
      const step = range / 120;
      setVal(currentValue + deltaY * step);
    });

    const stop = (e) => {
      if (isDragging) {
        isDragging = false;
        try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      }
    };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);

    // Doble clic para valor inicial
    el.addEventListener('dblclick', () => setVal(initial));

    setVal(initial);
  }

  updateKnobAngle(elementId, value, min, max) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const indicator = el.querySelector('.knob-indicator');
    if (!indicator) return;

    const norm = (value - min) / (max - min);
    const angle = -135 + norm * 270; // -135° a +135°
    indicator.style.transform = `rotate(${angle}deg)`;
  }

  // --- Botones de Estado y Switches ---
  bindButtons() {
    // EQ IN (Bypass)
    const btnEqInCh1 = document.getElementById('btn-eqin-ch1');
    const btnEqInCh2 = document.getElementById('btn-eqin-ch2');

    btnEqInCh1.addEventListener('click', () => {
      const active = !btnEqInCh1.classList.contains('active');
      btnEqInCh1.classList.toggle('active', active);
      this.engine.setEqIn(0, active);
      if (this.engine.stereoLink) {
        btnEqInCh2.classList.toggle('active', active);
      }
      this.showToast(active ? 'EQ Canal 1 Activado' : 'EQ Canal 1 en Bypass');
    });

    btnEqInCh2.addEventListener('click', () => {
      const active = !btnEqInCh2.classList.contains('active');
      btnEqInCh2.classList.toggle('active', active);
      this.engine.setEqIn(1, active);
      this.showToast(active ? 'EQ Canal 2 Activado' : 'EQ Canal 2 en Bypass');
    });

    // RANGO (±12 dB / ±6 dB)
    const btnRangeCh1 = document.getElementById('btn-range-ch1');
    const btnRangeCh2 = document.getElementById('btn-range-ch2');

    const toggleRange = () => {
      const newMode = this.engine.rangeMode === 12 ? 6 : 12;
      this.engine.setRangeMode(newMode);
      const is6 = newMode === 6;
      btnRangeCh1.classList.toggle('active', is6);
      btnRangeCh2.classList.toggle('active', is6);
      btnRangeCh1.querySelector('.btn-text').textContent = is6 ? '±6 dB' : '±12 dB';
      btnRangeCh2.querySelector('.btn-text').textContent = is6 ? '±6 dB' : '±12 dB';
      this.showToast(`Rango de ecualización: ±${newMode} dB`);
    };

    btnRangeCh1.addEventListener('click', toggleRange);
    btnRangeCh2.addEventListener('click', toggleRange);

    // FBQ FEEDBACK DETECTION
    const btnFbqCh1 = document.getElementById('btn-fbq-ch1');
    const btnFbqCh2 = document.getElementById('btn-fbq-ch2');

    btnFbqCh1.addEventListener('click', () => {
      const active = !btnFbqCh1.classList.contains('active');
      btnFbqCh1.classList.toggle('active', active);
      this.engine.fbqEnabledCh1 = active;
      if (this.engine.stereoLink) {
        btnFbqCh2.classList.toggle('active', active);
        this.engine.fbqEnabledCh2 = active;
      }
      this.showToast(active ? 'Sistema FBQ Activado (Detección de Acoples)' : 'Sistema FBQ Desactivado');
    });

    btnFbqCh2.addEventListener('click', () => {
      const active = !btnFbqCh2.classList.contains('active');
      btnFbqCh2.classList.toggle('active', active);
      this.engine.fbqEnabledCh2 = active;
    });

    // STEREO LINK
    const btnStereoLink = document.getElementById('btn-stereo-link');
    btnStereoLink.addEventListener('click', () => {
      const active = !btnStereoLink.classList.contains('active');
      btnStereoLink.classList.toggle('active', active);
      this.engine.setStereoLink(active);
      this.showToast(active ? 'Canales Enlazados en Estéreo (L+R)' : 'Canales Independientes (Dual Mono)');
    });

    // SUBWOOFER MUTE
    const btnSubMute = document.getElementById('btn-sub-mute');
    btnSubMute.addEventListener('click', () => {
      const muted = !btnSubMute.classList.contains('active');
      btnSubMute.classList.toggle('active', muted);
      const freq = parseFloat(document.getElementById('val-sub-freq').dataset.val || '80');
      const level = parseFloat(document.getElementById('val-sub-level').dataset.val || '0');
      this.engine.setSubwooferParams(freq, level, muted);
      this.showToast(muted ? 'Salida Subwoofer Silenciada' : 'Salida Subwoofer Activa');
    });

    // REINICIAR / APLANAR BANDAS (FLAT)
    document.getElementById('btn-reset-all').addEventListener('click', () => {
      this.applyPreset(this.presets.flat);
      this.showToast('Todas las bandas restablecidas a 0 dB (Plano)');
    });
  }

  // --- Fuentes de Audio (Micrófono, Archivo, Carpeta Entera, Generador) ---
  bindAudioSourceControls() {
    const audioElement = document.getElementById('audio-file-element');
    const fileInput = document.getElementById('file-input');
    const folderInput = document.getElementById('folder-input');
    const btnSourceFile = document.getElementById('btn-src-file');
    const btnSourceFolder = document.getElementById('btn-src-folder');
    const btnSourceMic = document.getElementById('btn-src-mic');
    const btnSourceGen = document.getElementById('btn-src-gen');
    const btnPlay = document.getElementById('btn-player-play');
    const btnPrev = document.getElementById('btn-player-prev');
    const btnNext = document.getElementById('btn-player-next');
    const btnStop = document.getElementById('btn-player-stop');
    const seekSlider = document.getElementById('player-seek');
    const fileNameDisplay = document.getElementById('file-name-display');
    const playlistCounter = document.getElementById('playlist-counter');
    const timeDisplay = document.getElementById('time-display');
    const btnOpenPlaylist = document.getElementById('btn-open-playlist');

    const clearSourceActive = () => {
      btnSourceFile.classList.remove('active');
      if (btnSourceFolder) btnSourceFolder.classList.remove('active');
      btnSourceMic.classList.remove('active');
      btnSourceGen.classList.remove('active');
    };

    // Función para cargar y reproducir una pista de la lista
    this.loadTrack = async (index, autoPlay = true) => {
      if (index < 0 || index >= this.playlist.length) return;
      this.currentTrackIndex = index;
      const file = this.playlist[index];

      // Liberar memoria del objeto anterior si existía
      if (this.currentObjectUrl) {
        try { URL.revokeObjectURL(this.currentObjectUrl); } catch (e) {}
      }
      this.currentObjectUrl = URL.createObjectURL(file);

      audioElement.src = this.currentObjectUrl;
      audioElement.load();

      seekSlider.value = 0;
      timeDisplay.textContent = '0:00 / 0:00';
      fileNameDisplay.textContent = file.name;
      if (playlistCounter) {
        playlistCounter.textContent = `Pista ${index + 1} de ${this.playlist.length}`;
      }

      await this.engine.setFileSource(audioElement);
      clearSourceActive();
      btnSourceFile.classList.add('active');

      if (autoPlay) {
        try {
          await audioElement.play();
          btnPlay.innerHTML = '&#10074;&#10074;';
        } catch (err) {
          console.warn('Reproducción en espera de interacción:', err);
          btnPlay.innerHTML = '&#9658;';
        }
      } else {
        btnPlay.innerHTML = '&#9658;';
      }

      this.updatePlaylistModalItems();
      this.showToast(`Pista ${index + 1}/${this.playlist.length}: ${file.name}`);
    };

    // Pista anterior
    this.playPreviousTrack = () => {
      if (this.playlist.length === 0) return;
      if (audioElement.currentTime > 3) {
        audioElement.currentTime = 0;
        return;
      }
      let prevIndex = this.currentTrackIndex - 1;
      if (prevIndex < 0) prevIndex = this.playlist.length - 1;
      this.loadTrack(prevIndex, true);
    };

    // Pista siguiente
    this.playNextTrack = () => {
      if (this.playlist.length === 0) return;
      let nextIndex = this.currentTrackIndex + 1;
      if (nextIndex >= this.playlist.length) nextIndex = 0;
      this.loadTrack(nextIndex, true);
    };

    if (btnPrev) btnPrev.addEventListener('click', () => this.playPreviousTrack());
    if (btnNext) btnNext.addEventListener('click', () => this.playNextTrack());

    // Pasar automáticamente a la siguiente canción al terminar
    audioElement.addEventListener('ended', () => {
      this.playNextTrack();
    });

    // Control de errores de formato en audios individuales
    audioElement.addEventListener('error', () => {
      if (this.playlist.length > 1) {
        this.showToast('Archivo no compatible, pasando al siguiente...');
        setTimeout(() => this.playNextTrack(), 800);
      }
    });

    // 1. Selector de Archivos (Múltiples)
    btnSourceFile.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|ogg|aac|wma)$/i.test(f.name));
      if (files.length === 0) return;

      this.playlist = files;
      this.loadTrack(0, true);
    });

    // 2. Selector de Carpeta Completa
    if (btnSourceFolder) {
      btnSourceFolder.addEventListener('click', () => {
        folderInput.click();
      });
    }

    if (folderInput) {
      folderInput.addEventListener('change', async (e) => {
        const rawFiles = Array.from(e.target.files);
        const audioFiles = rawFiles.filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|ogg|aac|wma)$/i.test(f.name));
        
        if (audioFiles.length === 0) {
          alert('No se encontraron archivos de audio (MP3, WAV, FLAC, etc.) en la carpeta seleccionada.');
          return;
        }

        // Ordenar alfabéticamente/numéricamente las pistas de la carpeta
        audioFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        this.playlist = audioFiles;
        this.loadTrack(0, true);
        this.showToast(`Carpeta cargada: ${audioFiles.length} canciones encontradas`);
      });
    }

    // Modal de Playlist
    if (btnOpenPlaylist) {
      btnOpenPlaylist.addEventListener('click', () => {
        this.openPlaylistModal();
      });
    }

    btnPlay.addEventListener('click', async () => {
      await this.engine.resumeContext();
      if (this.engine.sourceType !== 'file') {
        if (this.playlist.length > 0 && this.currentTrackIndex >= 0) {
          await this.loadTrack(this.currentTrackIndex, true);
        } else if (audioElement.src) {
          await this.engine.setFileSource(audioElement);
          clearSourceActive();
          btnSourceFile.classList.add('active');
          audioElement.play();
          btnPlay.innerHTML = '&#10074;&#10074;';
        } else {
          fileInput.click();
          return;
        }
      } else {
        if (audioElement.paused) {
          audioElement.play();
          btnPlay.innerHTML = '&#10074;&#10074;';
        } else {
          audioElement.pause();
          btnPlay.innerHTML = '&#9658;';
        }
      }
    });

    btnStop.addEventListener('click', () => {
      audioElement.pause();
      audioElement.currentTime = 0;
      btnPlay.innerHTML = '&#9658;';
    });

    audioElement.addEventListener('timeupdate', () => {
      if (audioElement.duration) {
        const percent = (audioElement.currentTime / audioElement.duration) * 100;
        seekSlider.value = percent;
        const curMin = Math.floor(audioElement.currentTime / 60);
        const curSec = Math.floor(audioElement.currentTime % 60);
        const durMin = Math.floor(audioElement.duration / 60);
        const durSec = Math.floor(audioElement.duration % 60);
        timeDisplay.textContent = `${curMin}:${curSec < 10 ? '0' : ''}${curSec} / ${durMin}:${durSec < 10 ? '0' : ''}${durSec}`;
      }
    });

    seekSlider.addEventListener('input', () => {
      if (audioElement.duration) {
        audioElement.currentTime = (seekSlider.value / 100) * audioElement.duration;
      }
    });

    // 3. Micrófono / Entrada de Línea / Virtual Cable
    btnSourceMic.addEventListener('click', async () => {
      try {
        await this.engine.setMicSource();
        audioElement.pause();
        btnPlay.innerHTML = '&#9658;';
        clearSourceActive();
        btnSourceMic.classList.add('active');
        fileNameDisplay.textContent = 'Mic / Entrada Línea Activa';
        if (playlistCounter) playlistCounter.textContent = 'En vivo';
        this.showToast('Entrada de micrófono / línea conectada en tiempo real');
      } catch (err) {
        alert('No se pudo acceder al micrófono o dispositivo de audio. Permite los permisos en tu navegador.');
      }
    });

    // 4. Generador de Señales de Calibración
    btnSourceGen.addEventListener('click', () => {
      document.getElementById('modal-generator').classList.add('open');
    });

    document.querySelectorAll('.gen-type-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.type;
        const freq = parseFloat(document.getElementById('gen-freq-input').value || 1000);
        await this.engine.resumeContext();
        audioElement.pause();
        btnPlay.innerHTML = '&#9658;';
        this.engine.setGeneratorSource(type, freq);
        clearSourceActive();
        btnSourceGen.classList.add('active');
        fileNameDisplay.textContent = `Generador: ${type.toUpperCase()}`;
        if (playlistCounter) playlistCounter.textContent = 'Señal sintética';
        document.getElementById('modal-generator').classList.remove('open');
        this.showToast(`Generando señal de prueba: ${type}`);
      });
    });

    document.getElementById('btn-stop-generator').addEventListener('click', () => {
      this.engine.disconnectCurrentSource();
      clearSourceActive();
      fileNameDisplay.textContent = 'Sin señal';
      document.getElementById('modal-generator').classList.remove('open');
      this.showToast('Generador detenido');
    });
  }

  openPlaylistModal() {
    const modal = document.getElementById('modal-playlist');
    if (!modal) return;
    this.updatePlaylistModalItems();
    modal.classList.add('open');
  }

  updatePlaylistModalItems(filterText = '') {
    const container = document.getElementById('playlist-items-container');
    const countEl = document.getElementById('modal-track-count');
    if (!container) return;

    if (countEl) countEl.textContent = this.playlist.length;
    container.innerHTML = '';

    if (this.playlist.length === 0) {
      container.innerHTML = '<p style="font-size: 0.8rem; color: #8fa0b3; text-align: center; padding: 20px;">No has cargado ninguna carpeta o archivo todavía.<br><br>Usa el botón <strong>📂 Carpeta</strong> para cargar todo tu álbum o carpeta de música.</p>';
      return;
    }

    const filter = filterText.toLowerCase();

    this.playlist.forEach((file, idx) => {
      if (filter && !file.name.toLowerCase().includes(filter)) return;

      const item = document.createElement('div');
      item.className = `playlist-item ${idx === this.currentTrackIndex ? 'active' : ''}`;
      
      const numSpan = document.createElement('span');
      numSpan.style.fontFamily = 'var(--font-mono)';
      numSpan.style.marginRight = '8px';
      numSpan.style.color = idx === this.currentTrackIndex ? '#000' : '#ffaa00';
      numSpan.textContent = `${idx + 1}.`;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'playlist-item-name';
      nameSpan.style.flex = '1';
      nameSpan.style.whiteSpace = 'nowrap';
      nameSpan.style.overflow = 'hidden';
      nameSpan.style.textOverflow = 'ellipsis';
      nameSpan.textContent = file.name;

      item.appendChild(numSpan);
      item.appendChild(nameSpan);

      item.addEventListener('click', () => {
        this.loadTrack(idx, true);
      });

      container.appendChild(item);
    });

    const searchInput = document.getElementById('playlist-search-input');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';
      searchInput.addEventListener('input', (e) => {
        this.updatePlaylistModalItems(e.target.value);
      });
    }
  }

  // --- Presets y Exportación ---
  bindPresets() {
    const select = document.getElementById('preset-selector');
    this.refreshPresetDropdown();

    select.addEventListener('change', () => {
      const key = select.value;
      if (this.presets[key]) {
        this.applyPreset(this.presets[key]);
        this.showToast(`Preset cargado: ${this.presets[key].name}`);
      }
    });

    // Guardar preset personalizado
    document.getElementById('btn-save-preset').addEventListener('click', () => {
      const name = prompt('Ingresa el nombre para tu preset personalizado:');
      if (!name) return;

      const key = `custom_${Date.now()}`;
      const presetData = {
        name,
        description: 'Preset personalizado del usuario',
        lowCut: 10,
        highCut: 30000,
        inputGain: 0,
        gains: Array.from(this.engine.ch1.currentGains)
      };

      this.presets[key] = presetData;
      this.saveCustomPresetsToStorage();
      this.refreshPresetDropdown();
      select.value = key;
      this.showToast(`Preset "${name}" guardado exitosamente`);
    });

    // Exportar archivo Equalizer APO (.txt)
    document.getElementById('btn-export-apo').addEventListener('click', () => {
      const content = this.engine.exportEqualizerAPO();
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'config_31band_equalizer_apo.txt';
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Archivo Equalizer APO exportado (.txt)');
    });
  }

  refreshPresetDropdown() {
    const select = document.getElementById('preset-selector');
    if (!select) return;
    select.innerHTML = '<option value="">-- Seleccionar Curva / Preset --</option>';

    Object.entries(this.presets).forEach(([key, preset]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = preset.name;
      select.appendChild(opt);
    });
  }

  applyPreset(preset) {
    if (!preset || !preset.gains) return;
    
    // Aplicar los 31 faders
    preset.gains.forEach((gain, i) => {
      this.setFaderDb(0, i, gain, false);
      this.setFaderDb(1, i, gain, false);
      this.engine.setBandGain(0, i, gain);
      this.engine.setBandGain(1, i, gain);
    });

    // Aplicar Input Gain si el preset lo especifica
    if (typeof preset.inputGain === 'number') {
      const ig = preset.inputGain;
      this.engine.setInputGain(0, ig);
      this.engine.setInputGain(1, ig);
      this.updateKnobAngle('knob-in-ch1', ig, -12, 12);
      this.updateKnobAngle('knob-in-ch2', ig, -12, 12);
      const igTxt = `${ig > 0 ? '+' : ''}${ig.toFixed(1)}dB`;
      const valIn1 = document.getElementById('val-in-ch1');
      const valIn2 = document.getElementById('val-in-ch2');
      if (valIn1) valIn1.textContent = igTxt;
      if (valIn2) valIn2.textContent = igTxt;
    }

    // Aplicar Low Cut si el preset lo especifica
    if (typeof preset.lowCut === 'number') {
      const lc = preset.lowCut;
      this.engine.setLowCut(0, lc);
      this.engine.setLowCut(1, lc);
      this.updateKnobAngle('knob-lc-ch1', lc, 10, 400);
      this.updateKnobAngle('knob-lc-ch2', lc, 10, 400);
      const lcTxt = `${Math.round(lc)}Hz`;
      const valLc1 = document.getElementById('val-lc-ch1');
      const valLc2 = document.getElementById('val-lc-ch2');
      if (valLc1) valLc1.textContent = lcTxt;
      if (valLc2) valLc2.textContent = lcTxt;
    }

    // Aplicar High Cut si el preset lo especifica
    if (typeof preset.highCut === 'number') {
      const hc = preset.highCut;
      this.engine.setHighCut(0, hc);
      this.engine.setHighCut(1, hc);
      this.updateKnobAngle('knob-hc-ch1', hc, 2500, 32000);
      this.updateKnobAngle('knob-hc-ch2', hc, 2500, 32000);
      const hcTxt = hc >= 1000 ? `${(hc / 1000).toFixed(1)}k` : `${Math.round(hc)}Hz`;
      const valHc1 = document.getElementById('val-hc-ch1');
      const valHc2 = document.getElementById('val-hc-ch2');
      if (valHc1) valHc1.textContent = hcTxt;
      if (valHc2) valHc2.textContent = hcTxt;
    }
  }

  saveCustomPresetsToStorage() {
    const customs = {};
    Object.entries(this.presets).forEach(([k, v]) => {
      if (k.startsWith('custom_')) customs[k] = v;
    });
    localStorage.setItem('eq31_custom_presets', JSON.stringify(customs));
  }

  loadCustomPresets() {
    try {
      const saved = localStorage.getItem('eq31_custom_presets');
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(this.presets, parsed);
      }
    } catch (e) {}
  }

  // --- Modales y Pestañas Móviles ---
  bindModals() {
    // Modal Analizador RTA
    const modalRta = document.getElementById('modal-rta');
    document.getElementById('btn-open-rta').addEventListener('click', () => {
      modalRta.classList.add('open');
      this.initRtaCanvas();
    });

    // Modal Guía de uso
    const modalGuide = document.getElementById('modal-guide');
    document.getElementById('btn-open-guide').addEventListener('click', () => {
      modalGuide.classList.add('open');
    });

    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
      });
    });

    window.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('open');
      }
    });
  }

  bindMobileTabs() {
    const tabs = document.querySelectorAll('.mobile-tab-btn');
    const stripCh1 = document.getElementById('strip-ch1');
    const stripCh2 = document.getElementById('strip-ch2');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const view = tab.dataset.view;
        this.activeMobileTab = view;

        if (view === 'ch1') {
          stripCh1.classList.remove('mobile-hidden');
          stripCh2.classList.add('mobile-hidden');
        } else if (view === 'ch2') {
          stripCh1.classList.add('mobile-hidden');
          stripCh2.classList.remove('mobile-hidden');
        } else {
          stripCh1.classList.remove('mobile-hidden');
          stripCh2.classList.remove('mobile-hidden');
        }
      });
    });
  }

  // --- Bucle Render 60 FPS (Vúmetros, FBQ LEDs) ---
  startRenderLoop() {
    const render = () => {
      if (this.engine.isInitialized) {
        this.engine.updateMetersAndFbq();

        // 1. Actualizar Vúmetros
        this.updateMeterDisplay(this.engine.ch1.levelMeter, this.metersCh1);
        this.updateMeterDisplay(this.engine.ch2.levelMeter, this.metersCh2);

        // 2. Actualizar LEDs FBQ en manillas de faders
        this.updateFbqLeds(0, this.fadersCh1, this.engine.ch1, this.engine.fbqEnabledCh1);
        this.updateFbqLeds(1, this.fadersCh2, this.engine.ch2, this.engine.fbqEnabledCh2);

        // 3. Dibujar RTA si el modal está abierto
        if (this.rtaCanvasCtx && document.getElementById('modal-rta').classList.contains('open')) {
          this.drawRtaSpectrum();
        }
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  }

  updateMeterDisplay(meterState, meterArray) {
    const currentRms = meterState.rms;
    const peakHold = meterState.peakHold;

    meterArray.forEach(item => {
      const isOn = currentRms >= item.db;
      const isPeak = Math.abs(peakHold - item.db) < 3 && peakHold >= item.db;

      if (isOn || isPeak) {
        item.led.classList.add('on');
        if (isPeak && !isOn) item.led.classList.add('peak-hold');
        else item.led.classList.remove('peak-hold');
      } else {
        item.led.classList.remove('on', 'peak-hold');
      }
    });
  }

  updateFbqLeds(channelIndex, faderArray, chState, isFbqOn) {
    faderArray.forEach((fader, b) => {
      const pip = fader.ledPip;
      if (!isFbqOn) {
        pip.className = 'fader-led-pip';
        return;
      }

      const peakState = chState.fbqPeaks[b];
      if (peakState === 2) {
        pip.className = 'fader-led-pip fbq-feedback';
      } else if (peakState === 1) {
        pip.className = 'fader-led-pip fbq-signal';
      } else {
        pip.className = 'fader-led-pip fbq-normal';
      }
    });
  }

  // --- Analizador de Espectro RTA en Tiempo Real ---
  initRtaCanvas() {
    const canvas = document.getElementById('rta-canvas');
    if (!canvas) return;
    this.rtaCanvas = canvas;
    this.rtaCanvasCtx = canvas.getContext('2d');
  }

  drawRtaSpectrum() {
    const ctx = this.rtaCanvasCtx;
    const w = this.rtaCanvas.width;
    const h = this.rtaCanvas.height;

    ctx.fillStyle = '#090a0c';
    ctx.fillRect(0, 0, w, h);

    // Dibujar cuadrícula de frecuencia
    ctx.strokeStyle = '#1e242c';
    ctx.lineWidth = 1;

    ISO_FREQUENCIES.forEach((freq, i) => {
      const x = (i / 30) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    });

    // Curva de Ecualización resultante
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ISO_FREQUENCIES.forEach((freq, i) => {
      const gain = this.engine.ch1.currentGains[i];
      const x = (i / 30) * w;
      const y = h / 2 - (gain / 12) * (h / 2.5);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Espectro en Vivo (Barras de energía por banda ISO)
    const barWidth = (w / 31) - 2;
    for (let i = 0; i < 31; i++) {
      const energyDb = this.engine.ch1.fbqEnergy[i];
      const norm = Math.max(0, Math.min(1, (energyDb + 80) / 80));
      const barH = norm * h;
      const x = i * (w / 31) + 1;
      const y = h - barH;

      const isFeedback = this.engine.ch1.fbqPeaks[i] === 2;
      ctx.fillStyle = isFeedback ? '#ff1100' : 'rgba(255, 170, 0, 0.7)';
      ctx.fillRect(x, y, barWidth, barH);
    }
  }

  showToast(text) {
    const toast = document.getElementById('toast-msg');
    if (!toast) return;
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
  }
}
