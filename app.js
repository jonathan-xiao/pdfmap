const COLORS = [
  '#185FA5',
  '#D94848',
  '#2D8F4E',
  '#D97706',
  '#7C3AED',
  '#0F766E'
];

const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
const SUPABASE_TABLE = 'map_pins';
const LOCAL_STORAGE_KEY = 'pdfmapidea:pins:v1';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;

const elements = {
  uploadButtons: [document.getElementById('btn-upload')],
  fileInputs: [document.getElementById('file-input'), document.getElementById('file-input-tb')],
  zoomOut: document.getElementById('btn-zoom-out'),
  zoomIn: document.getElementById('btn-zoom-in'),
  zoomFit: document.getElementById('btn-zoom-fit'),
  zoomLabel: document.getElementById('zoom-label'),
  pinMode: document.getElementById('mode-pin'),
  exportPins: document.getElementById('btn-export'),
  pagePrev: document.getElementById('btn-prev-page'),
  pageNext: document.getElementById('btn-next-page'),
  pageInfo: document.getElementById('page-info'),
  pageControls: document.getElementById('page-controls'),
  canvasArea: document.getElementById('canvas-area'),
  dropZone: document.getElementById('drop-zone'),
  mapContainer: document.getElementById('map-container'),
  canvas: document.getElementById('pdf-canvas'),
  pinModal: document.getElementById('pin-modal'),
  pinLabelInput: document.getElementById('pin-label-input'),
  colorRow: document.getElementById('color-row'),
  cancelPin: document.getElementById('btn-cancel-pin'),
  savePin: document.getElementById('btn-save-pin'),
  pinList: document.getElementById('pin-list'),
  pinCount: document.getElementById('pin-count'),
  noPins: document.getElementById('no-pins')
};

const state = {
  pdfFile: null,
  pdfDoc: null,
  pdfFingerprint: null,
  currentPage: 1,
  scale: 1,
  fitScale: 1,
  zoomMode: 'fit',
  renderTask: null,
  pins: [],
  activePinId: null,
  pendingPin: null,
  selectedColor: COLORS[0],
  supabase: null
};

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

if (window.supabase && typeof window.supabase.createClient === 'function') {
  const looksConfigured =
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes('YOUR_PROJECT') &&
    !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY');

  if (looksConfigured) {
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

function setToolbarEnabled(enabled) {
  elements.zoomOut.disabled = !enabled;
  elements.zoomIn.disabled = !enabled;
  elements.zoomFit.disabled = !enabled;
  elements.pinMode.disabled = !enabled;
  elements.exportPins.disabled = !enabled;
  elements.pagePrev.disabled = !enabled;
  elements.pageNext.disabled = !enabled;
}

function updateZoomLabel() {
  elements.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
}

function updatePageInfo() {
  if (!state.pdfDoc) {
    elements.pageInfo.textContent = 'Page 1 of 1';
    return;
  }

  elements.pageInfo.textContent = `Page ${state.currentPage} of ${state.pdfDoc.numPages}`;
  elements.pagePrev.disabled = state.currentPage <= 1;
  elements.pageNext.disabled = state.currentPage >= state.pdfDoc.numPages;
}

function openPinModal(xPercent, yPercent, xPixels, yPixels) {
  state.pendingPin = { xPercent, yPercent, pageNumber: state.currentPage };
  elements.pinModal.style.left = `${Math.max(16, xPixels + 12)}px`;
  elements.pinModal.style.top = `${Math.max(16, yPixels + 12)}px`;
  elements.pinModal.style.display = 'block';
  elements.pinLabelInput.value = '';
  elements.pinLabelInput.focus();
  elements.pinLabelInput.select();
}

function closePinModal() {
  state.pendingPin = null;
  elements.pinModal.style.display = 'none';
}

function renderColorPicker() {
  elements.colorRow.innerHTML = '';

  COLORS.forEach((color, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `color-chip${index === 0 ? ' selected' : ''}`;
    chip.style.background = color;
    chip.title = color;
    chip.setAttribute('aria-label', `Select color ${index + 1}`);
    chip.addEventListener('click', () => {
      state.selectedColor = color;
      [...elements.colorRow.querySelectorAll('.color-chip')].forEach((node) => node.classList.remove('selected'));
      chip.classList.add('selected');
    });
    elements.colorRow.appendChild(chip);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readLocalStore() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeLocalStore(store) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
}

function getLocalPinsForDocument(documentId) {
  const store = readLocalStore();
  return Array.isArray(store[documentId]) ? store[documentId] : [];
}

function setLocalPinsForDocument(documentId, pins) {
  const store = readLocalStore();
  store[documentId] = pins;
  writeLocalStore(store);
}

function normalizePin(pin) {
  return {
    id: pin.id || crypto.randomUUID(),
    documentId: pin.documentId || pin.document_id || state.pdfFingerprint,
    pageNumber: Number(pin.pageNumber || pin.page_number || 1),
    label: pin.label || 'Untitled pin',
    color: pin.color || COLORS[0],
    xPercent: Number(pin.xPercent ?? pin.x_percent ?? 0),
    yPercent: Number(pin.yPercent ?? pin.y_percent ?? 0),
    createdAt: pin.createdAt || pin.created_at || new Date().toISOString()
  };
}

function sortPins(pins) {
  return [...pins].sort((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

async function readFileAsArrayBuffer(file) {
  return file.arrayBuffer();
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function createDocumentId(file, arrayBuffer) {
  if (window.crypto && window.crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return bufferToHex(digest);
  }

  return [file.name, file.size, file.lastModified].join(':');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setDropZoneVisible(visible) {
  elements.dropZone.style.display = visible ? 'flex' : 'none';
}

function setMapVisible(visible) {
  elements.mapContainer.classList.toggle('visible', visible);
}

function setPageControlsVisible(visible) {
  elements.pageControls.classList.toggle('visible', visible);
}

function showMessage(text) {
  elements.pageInfo.textContent = text;
}

async function loadPinsForDocument() {
  if (!state.pdfFingerprint) {
    state.pins = [];
    renderPins();
    return;
  }

  if (state.supabase) {
    const { data, error } = await state.supabase
      .from(SUPABASE_TABLE)
      .select('*')
      .eq('document_id', state.pdfFingerprint)
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data)) {
      state.pins = data.map(normalizePin);
      renderPins();
      return;
    }
  }

  state.pins = getLocalPinsForDocument(state.pdfFingerprint).map(normalizePin);
  renderPins();
}

async function persistPin(pin) {
  const normalized = normalizePin(pin);

  if (state.supabase) {
    const payload = {
      id: normalized.id,
      document_id: normalized.documentId,
      page_number: normalized.pageNumber,
      label: normalized.label,
      color: normalized.color,
      x_percent: normalized.xPercent,
      y_percent: normalized.yPercent,
      created_at: normalized.createdAt
    };

    const { data, error } = await state.supabase
      .from(SUPABASE_TABLE)
      .insert(payload)
      .select('*')
      .single();

    if (!error && data) {
      return normalizePin(data);
    }

    console.warn('Supabase insert failed, falling back to local storage.', error);
  }

  const localPins = getLocalPinsForDocument(state.pdfFingerprint);
  localPins.push(normalized);
  setLocalPinsForDocument(state.pdfFingerprint, localPins);
  return normalized;
}

async function deletePin(pinId) {
  if (state.supabase) {
    const { error } = await state.supabase.from(SUPABASE_TABLE).delete().eq('id', pinId);
    if (error) {
      console.warn('Supabase delete failed, falling back to local storage.', error);
    } else {
      return;
    }
  }

  const localPins = getLocalPinsForDocument(state.pdfFingerprint).filter((pin) => pin.id !== pinId);
  setLocalPinsForDocument(state.pdfFingerprint, localPins);
}

function renderSidebarPins() {
  elements.pinList.innerHTML = '';
  elements.pinCount.textContent = String(state.pins.length);
  elements.noPins.style.display = state.pins.length ? 'none' : 'flex';

  if (!state.pins.length) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const sortedPins = sortPins(state.pins);

  sortedPins.forEach((pin) => {
    const item = document.createElement('div');
    item.className = `pin-item${pin.id === state.activePinId ? ' active' : ''}`;
    item.innerHTML = `
      <div class="pin-color-dot" style="background:${pin.color}"></div>
      <div class="pin-item-info">
        <div class="pin-item-label">${escapeHtml(pin.label)}</div>
        <div class="pin-item-coords">Page ${pin.pageNumber} · ${pin.xPercent.toFixed(1)}%, ${pin.yPercent.toFixed(1)}%</div>
      </div>
      <button class="pin-delete" type="button" aria-label="Delete pin"> <i class="ti ti-trash" aria-hidden="true"></i></button>
    `;

    item.addEventListener('click', () => {
      state.activePinId = pin.id;
      goToPage(pin.pageNumber);
      renderSidebarPins();
    });

    item.querySelector('.pin-delete').addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmed = window.confirm('Delete this pin?');
      if (!confirmed) {
        return;
      }

      try {
        await deletePin(pin.id);
        state.pins = state.pins.filter((entry) => entry.id !== pin.id);
        if (state.activePinId === pin.id) {
          state.activePinId = null;
        }
        renderSidebarPins();
        renderPins();
      } catch (error) {
        console.error(error);
        window.alert('Could not delete the pin.');
      }
    });

    fragment.appendChild(item);
  });

  elements.pinList.appendChild(fragment);
}

function renderPins() {
  elements.mapContainer.querySelectorAll('.pin').forEach((node) => node.remove());

  if (!state.pdfDoc) {
    return;
  }

  const pagePins = state.pins.filter((pin) => pin.pageNumber === state.currentPage);
  pagePins.forEach((pin) => {
    const pinElement = document.createElement('button');
    pinElement.type = 'button';
    pinElement.className = `pin${pin.id === state.activePinId ? ' active' : ''}`;
    pinElement.style.left = `${pin.xPercent}%`;
    pinElement.style.top = `${pin.yPercent}%`;
    pinElement.dataset.pinId = pin.id;
    pinElement.innerHTML = `
      <div class="pin-dot" style="background:${pin.color}"><div class="pin-dot-inner"></div></div>
      <div class="pin-label">${escapeHtml(pin.label)}</div>
    `;

    pinElement.addEventListener('click', (event) => {
      event.stopPropagation();
      state.activePinId = pin.id;
      renderSidebarPins();
      renderPins();
    });

    elements.mapContainer.appendChild(pinElement);
  });
}

function computeFitScale(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(320, elements.canvasArea.clientWidth - 32);
  const availableHeight = Math.max(320, elements.canvasArea.clientHeight - 32);
  return clamp(Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height), MIN_ZOOM, MAX_ZOOM);
}

async function renderPage() {
  if (!state.pdfDoc) {
    return;
  }

  const page = await state.pdfDoc.getPage(state.currentPage);
  state.fitScale = computeFitScale(page);

  if (state.zoomMode === 'fit') {
    state.scale = state.fitScale;
  }

  const viewport = page.getViewport({ scale: state.scale });
  const canvas = elements.canvas;
  const context = canvas.getContext('2d', { alpha: false });

  if (state.renderTask) {
    try {
      state.renderTask.cancel();
    } catch {
      // Ignore cancellation errors from a previous render.
    }
  }

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  elements.mapContainer.style.width = `${viewport.width}px`;
  elements.mapContainer.style.height = `${viewport.height}px`;

  const renderContext = {
    canvasContext: context,
    viewport
  };

  state.renderTask = page.render(renderContext);

  try {
    await state.renderTask.promise;
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') {
      throw error;
    }
  }

  updateZoomLabel();
  updatePageInfo();
  renderPins();
}

async function goToPage(pageNumber) {
  if (!state.pdfDoc) {
    return;
  }

  state.currentPage = clamp(pageNumber, 1, state.pdfDoc.numPages);
  await renderPage();
}

function clearDocumentState() {
  state.pdfFile = null;
  state.pdfDoc = null;
  state.pdfFingerprint = null;
  state.currentPage = 1;
  state.scale = 1;
  state.fitScale = 1;
  state.zoomMode = 'fit';
  state.renderTask = null;
  state.pins = [];
  state.activePinId = null;
  state.pendingPin = null;
  state.pinMode = false;
  closePinModal();
  setToolbarEnabled(false);
  setMapVisible(false);
  setPageControlsVisible(false);
  setDropZoneVisible(true);
  updateZoomLabel();
  updatePageInfo();
  renderSidebarPins();
}

async function loadDocument(file) {
  if (!file) {
    return;
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    window.alert('Please choose a PDF file.');
    return;
  }

  showMessage('Loading PDF...');
  clearDocumentState();
  state.pdfFile = file;

  try {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    state.pdfFingerprint = await createDocumentId(file, arrayBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    state.pdfDoc = await loadingTask.promise;
    state.currentPage = 1;
    state.zoomMode = 'fit';
    setToolbarEnabled(true);
    setDropZoneVisible(false);
    setMapVisible(true);
    setPageControlsVisible(true);
    await loadPinsForDocument();
    await renderPage();
  } catch (error) {
    console.error(error);
    window.alert('Could not open that PDF.');
    clearDocumentState();
  }
}

async function saveCurrentPin() {
  if (!state.pendingPin || !state.pdfFingerprint) {
    return;
  }

  const label = elements.pinLabelInput.value.trim() || 'Untitled pin';
  const nextPin = {
    id: crypto.randomUUID(),
    documentId: state.pdfFingerprint,
    pageNumber: state.pendingPin.pageNumber,
    label,
    color: state.selectedColor,
    xPercent: state.pendingPin.xPercent,
    yPercent: state.pendingPin.yPercent,
    createdAt: new Date().toISOString()
  };

  try {
    const savedPin = await persistPin(nextPin);
    state.pins = [...state.pins, savedPin];
    state.activePinId = savedPin.id;
    closePinModal();
    renderSidebarPins();
    renderPins();
  } catch (error) {
    console.error(error);
    window.alert('Could not save the pin.');
  }
}

function exportPins() {
  if (!state.pins.length) {
    window.alert('There are no pins to export yet.');
    return;
  }

  const payload = JSON.stringify(sortPins(state.pins), null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'pdf-map-pins.json';
  link.click();
  URL.revokeObjectURL(objectUrl);
}

function zoomBy(delta) {
  if (!state.pdfDoc) {
    return;
  }

  state.zoomMode = 'manual';
  state.scale = clamp(state.scale + delta, MIN_ZOOM, MAX_ZOOM);
  renderPage();
}

function fitToPage() {
  if (!state.pdfDoc) {
    return;
  }

  state.zoomMode = 'fit';
  renderPage();
}

function bindEvents() {
  elements.uploadButtons.forEach((button) => {
    button.addEventListener('click', () => elements.fileInputs[0].click());
  });

  elements.fileInputs.forEach((input) => {
    input.addEventListener('change', (event) => {
      const [file] = event.target.files || [];
      loadDocument(file);
      event.target.value = '';
    });
  });

  elements.zoomOut.addEventListener('click', () => zoomBy(-ZOOM_STEP));
  elements.zoomIn.addEventListener('click', () => zoomBy(ZOOM_STEP));
  elements.zoomFit.addEventListener('click', fitToPage);
  elements.pinMode.addEventListener('click', () => {
    if (!state.pdfDoc) {
      return;
    }
    state.pinMode = !state.pinMode;
    elements.pinMode.classList.toggle('active', state.pinMode);
    elements.canvasArea.classList.toggle('pin-mode', state.pinMode);
    if (!state.pinMode) {
      closePinModal();
    }
  });
  elements.exportPins.addEventListener('click', exportPins);
  elements.pagePrev.addEventListener('click', () => goToPage(state.currentPage - 1));
  elements.pageNext.addEventListener('click', () => goToPage(state.currentPage + 1));
  elements.cancelPin.addEventListener('click', closePinModal);
  elements.savePin.addEventListener('click', saveCurrentPin);
  elements.pinLabelInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      saveCurrentPin();
    } else if (event.key === 'Escape') {
      closePinModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePinModal();
      state.pinMode = false;
      elements.pinMode.classList.remove('active');
      elements.canvasArea.classList.remove('pin-mode');
    }
  });

  elements.canvasArea.addEventListener('click', (event) => {
    if (!state.pdfDoc || !state.pinMode || elements.pinModal.contains(event.target)) {
      return;
    }

    const canvasRect = elements.canvas.getBoundingClientRect();
    const xPixels = event.clientX - canvasRect.left;
    const yPixels = event.clientY - canvasRect.top;
    const x = (xPixels / canvasRect.width) * 100;
    const y = (yPixels / canvasRect.height) * 100;

    if (x < 0 || y < 0 || x > 100 || y > 100) {
      return;
    }

    openPinModal(x, y, xPixels, yPixels);
  });

  elements.canvasArea.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('drag-over');
  });

  elements.canvasArea.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('drag-over');
  });

  elements.canvasArea.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('drag-over');
    const [file] = event.dataTransfer.files || [];
    loadDocument(file);
  });

  window.addEventListener('resize', () => {
    if (state.pdfDoc) {
      renderPage();
    }
  });
}

function initialize() {
  renderColorPicker();
  bindEvents();
  clearDocumentState();
  setToolbarEnabled(false);
  setDropZoneVisible(true);
  elements.zoomLabel.textContent = '100%';
  elements.pinModal.style.display = 'none';
  elements.pageControls.classList.remove('visible');
}

initialize();
