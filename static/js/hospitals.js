/* ============================================================
   NearCares – Hospitals Page JS
   Original UI preserved exactly.
   Added: Mappls map shown after search, click → directions
   ============================================================ */

let userLat = null, userLng = null;
let selectedIllness = null, selectedBodyPart = null;
let allDiseases = [];

// ── Mappls map state ──────────────────────────────────────────
let mapplsMap     = null;
let markerLayer   = [];
let activePopup   = null;
let mapReady      = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadDiseases();
  initSearchBar();
  initFromURL();
  waitForMapplsSDK();   // load map in background, show when results arrive
});

// ── Wait for Mappls SDK to load (loaded async in HTML) ────────
function waitForMapplsSDK() {
  if (typeof mappls !== 'undefined') {
    initMap();
  } else {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (typeof mappls !== 'undefined') { clearInterval(t); initMap(); }
      else if (tries > 40) clearInterval(t); // give up after 8s
    }, 200);
  }
}

function initMap() {
  try {
    mapplsMap = new mappls.Map('map', {
      center: [23.0225, 72.5714],
      zoom:   12,
      search: false,
    });
    mapplsMap.addListener('load', () => {
      mapReady = true;
      if (userLat && userLng) {
        mapplsMap.setCenter([userLat, userLng]);
        mapplsMap.setZoom(13);
      }
    });
  } catch(e) {
    console.warn('Mappls map init failed:', e);
  }
}

function clearMarkers() {
  markerLayer.forEach(m => { try { m.setMap(null); } catch(e){} });
  markerLayer = [];
  if (activePopup) { try { activePopup.close(); } catch(e){} activePopup = null; }
}

function addHospitalMarker(h) {
  if (!mapplsMap || !mapReady) return;
  try {
    const marker = new mappls.Marker({
      map:      mapplsMap,
      position: [h.lat, h.lng],
      title:    h.name,
    });
    marker.addListener('click', () => showMarkerPopup(marker, h));
    markerLayer.push(marker);
  } catch(e) {}
}

function addUserMarker(lat, lng) {
  if (!mapplsMap || !mapReady) return;
  try {
    const m = new mappls.Marker({
      map:      mapplsMap,
      position: [lat, lng],
      title:    'You are here',
      icon: {
        url:    'https://apis.mappls.com/map_v3/1.3/img/marker/mylocation.png',
        size:   [30, 30],
        anchor: [15, 30],
      },
    });
    markerLayer.push(m);
  } catch(e) {}
}

function showMarkerPopup(marker, h) {
  if (activePopup) { try { activePopup.close(); } catch(e){} }
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`;
  try {
    activePopup = new mappls.InfoWindow({
      map:     mapplsMap,
      content: `<div style="font-size:13px;max-width:220px;line-height:1.6;padding:2px">
        <b style="font-size:14px">${h.name}</b><br>
        <span style="color:#555;font-size:12px">${h.address || ''}</span><br>
        ${h.distance ? `<span style="color:#3b82f6">📏 ${h.distance} km away</span><br>` : ''}
        ${h.phone    ? `📞 <a href="tel:${h.phone}" style="color:#007bff">${h.phone}</a><br>` : ''}
        <a href="${mapsUrl}" target="_blank"
           style="display:inline-block;margin-top:6px;padding:5px 12px;
                  background:#007bff;color:#fff;border-radius:6px;
                  text-decoration:none;font-size:12px;font-weight:600">
          🗺️ Get Directions
        </a>
      </div>`,
      position: [h.lat, h.lng],
    });
  } catch(e) {}
}

function showMap(hospitals) {
  const container = document.getElementById('mapContainer');
  if (!container) return;
  container.style.display = 'block';

  // Hide the "search to see hospitals" hint
  const hint = document.getElementById('mapHint');
  if (hint) { hint.style.opacity = '0'; setTimeout(() => hint.style.display = 'none', 400); }

  clearMarkers();

  // Wait for map ready if not yet
  const doPlace = () => {
    if (userLat && userLng) {
      addUserMarker(userLat, userLng);
      mapplsMap.setCenter([userLat, userLng]);
      mapplsMap.setZoom(13);
    }
    hospitals.forEach(h => { if (h.lat && h.lng) addHospitalMarker(h); });

    // Fit bounds to all markers
    if (hospitals.length > 0 && userLat) {
      try {
        const bounds = new mappls.LatLngBounds();
        bounds.extend([userLat, userLng]);
        hospitals.forEach(h => { if (h.lat && h.lng) bounds.extend([h.lat, h.lng]); });
        mapplsMap.fitBounds(bounds, { padding: 60 });
      } catch(e) {}
    }
  };

  if (mapReady) {
    doPlace();
  } else {
    // retry until ready
    let t = setInterval(() => {
      if (mapReady) { clearInterval(t); doPlace(); }
    }, 200);
    setTimeout(() => clearInterval(t), 5000);
  }
}

// ── Load disease list ─────────────────────────────────────────
async function loadDiseases() {
  try {
    const res = await fetch('/api/diseases');
    allDiseases = await res.json();
  } catch (e) { allDiseases = []; }
}

// ── Read URL params set by home page and auto-search ──────────
function initFromURL() {
  const p = new URLSearchParams(location.search);
  const lat      = parseFloat(p.get('lat'));
  const lng      = parseFloat(p.get('lng'));
  const illness  = p.get('illness');
  const bodyPart = p.get('body_part') || p.get('part');
  const name     = p.get('name') || p.get('q');
  const radius   = p.get('radius');

  if (radius) {
    const sel = document.getElementById('radiusSelect');
    if (sel) sel.value = radius;
  }

  if (lat && lng) {
    setLocation(lat, lng, null, true);
  } else {
    setLocationText('📡 Detecting location…', '');
    tryGPS(false);
  }

  if (illness) {
    selectedIllness = illness;
    selectedBodyPart = null;
    markPill(illness);
    waitForLocationThenSearch();
  } else if (bodyPart) {
    selectedBodyPart = bodyPart;
    selectedIllness = null;
    waitForLocationThenSearch();
  } else if (name) {
    const inp = document.getElementById('diseaseSearch');
    if (inp) inp.value = name;
    const match = allDiseases.find(d =>
      d.label.toLowerCase() === name.toLowerCase() || d.key === name);
    if (match) { selectedIllness = match.key; }
    waitForLocationThenSearch();
  }
}

function waitForLocationThenSearch() {
  const start = Date.now();
  const interval = setInterval(() => {
    if (userLat && userLng) {
      clearInterval(interval);
      searchHospitals();
    } else if (Date.now() - start > 5000) {
      // After 5s without location, stop waiting and prompt user
      clearInterval(interval);
      setLocationText('⚠️ Could not detect location', '');
      showResults(`<div style="padding:24px; background:#eff6ff; border-radius:14px; color:#1e40af; font-weight:500; text-align:center;">
        📍 Location could not be detected automatically.<br><br>
        <button onclick="refreshGPS()" style="background:#3b82f6;color:#fff;border:none;padding:10px 20px;border-radius:10px;cursor:pointer;font-weight:700;margin:4px;">
          📍 Try GPS Again
        </button>
        <button onclick="showChangeLocationModal()" style="background:#f1f5f9;color:#374151;border:none;padding:10px 20px;border-radius:10px;cursor:pointer;font-weight:700;margin:4px;">
          ✏️ Enter Location Manually
        </button>
      </div>`);
    }
  }, 300);
}

function setLocation(lat, lng, accuracy, resolveAddress) {
  userLat = lat;
  userLng = lng;
  // Center map on user location as soon as we have it (even before search)
  if (mapReady && mapplsMap) {
    mapplsMap.setCenter([lat, lng]);
    mapplsMap.setZoom(13);
  } else if (mapplsMap) {
    // Map not ready yet — set center after it loads
    mapplsMap.addListener && mapplsMap.addListener('load', () => {
      mapplsMap.setCenter([lat, lng]);
      mapplsMap.setZoom(13);
    });
  }
  if (resolveAddress) {
    setLocationText('📡 Resolving address…', '');
    fetch('/api/reverse-geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng })
    }).then(r => r.json()).then(data => {
      const addr = data.formatted_address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const acc  = accuracy ? `±${Math.round(accuracy)}m` : '';
      setLocationText('📍 ' + addr, acc);
    }).catch(() => {
      setLocationText(`📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`, accuracy ? `±${Math.round(accuracy)}m` : '');
    });
  }
}

function setLocationText(text, accuracy) {
  const el = document.getElementById('locationText');
  const ac = document.getElementById('accuracyText');
  if (el) el.textContent = text;
  if (ac) ac.textContent = accuracy || '';
}

function refreshGPS() {
  if (!navigator.geolocation) { showChangeLocationModal(); return; }
  setLocationText('📡 Getting GPS location…', '');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
      if (selectedIllness || selectedBodyPart) searchHospitals();
    },
    (err) => {
      console.warn('GPS error:', err.code, err.message);
      setLocationText('⚠️ GPS failed — enter location manually', '');
      showChangeLocationModal();
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

function tryGPS(showModalOnFail = true) {
  if (!navigator.geolocation) {
    setLocationText('⚠️ GPS not supported', '');
    if (showModalOnFail) showChangeLocationModal();
    return;
  }

  // Try high accuracy first, fall back to low accuracy if it fails
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
    },
    (err) => {
      // High accuracy failed — retry with low accuracy (faster, works indoors)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
        },
        () => {
          setLocationText('⚠️ Location unavailable', '');
          if (showModalOnFail) showChangeLocationModal();
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function showChangeLocationModal() {
  const modal = document.getElementById('changeLocModal');
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('changeLocInput')?.focus(), 100);
  }
}

function hideChangeLocationModal() {
  const modal = document.getElementById('changeLocModal');
  if (modal) modal.style.display = 'none';
  const errEl = document.getElementById('changeLocError');
  if (errEl) errEl.style.display = 'none';
}

document.addEventListener('click', e => {
  const modal = document.getElementById('changeLocModal');
  if (modal && e.target === modal) hideChangeLocationModal();
});

async function submitChangeLocation() {
  const input   = document.getElementById('changeLocInput');
  const errEl   = document.getElementById('changeLocError');
  const btn     = document.getElementById('changeLocBtn');
  const address = (input?.value || '').trim();

  if (!address) { input.style.borderColor = '#ef4444'; return; }

  btn.textContent = '🔄 Searching…';
  btn.disabled    = true;
  if (errEl) errEl.style.display = 'none';
  input.style.borderColor = '';

  try {
    const res  = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    const data = await res.json();

    if (data.success) {
      userLat = data.lat;
      userLng = data.lng;
      setLocationText('📍 ' + (data.formatted_address || address), '(manual)');
      hideChangeLocationModal();
      if (input) input.value = '';
      if (selectedIllness || selectedBodyPart) {
        searchHospitals();
      } else {
        showResults(`<div style="padding:20px; background:#f0fdf4; border-radius:12px; color:#166534; text-align:center;">
          ✅ Location set to <strong>${data.formatted_address || address}</strong><br>
          Now select a condition or body part above to search hospitals.
        </div>`);
      }
    } else {
      throw new Error(data.error || 'Address not found');
    }
  } catch (e) {
    if (errEl) {
      errEl.textContent = '❌ ' + e.message + '. Try a more specific address.';
      errEl.style.display = 'block';
    }
  } finally {
    btn.textContent = '🔍 Find Hospitals Here';
    btn.disabled    = false;
  }
}

function onRadiusChange() {
  if (userLat && userLng && (selectedIllness || selectedBodyPart)) searchHospitals();
}

function selectIllness(key) {
  selectedIllness  = key;
  selectedBodyPart = null;
  markPill(key);
  searchHospitals();
}

function selectBodyPart(part) {
  selectedBodyPart = part;
  selectedIllness  = null;
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('btn-primary'));
  searchHospitals();
}

function markPill(key) {
  document.querySelectorAll('.filter-pill').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.key === key);
  });
}

function initSearchBar() {
  const inp  = document.getElementById('diseaseSearch');
  const sugg = document.getElementById('searchSuggestions');
  if (!inp) return;

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2) { sugg.style.display = 'none'; return; }
    const matches = allDiseases.filter(d => d.label.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { sugg.style.display = 'none'; return; }
    sugg.innerHTML = matches.map(d =>
      `<div class="suggestion-item" onclick="pickSuggestion('${d.key}','${d.label.replace(/'/g,"\\'")}')">
        <span>${d.icon}</span> ${d.label}
      </div>`).join('');
    sugg.style.display = 'block';
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { triggerSearch(); sugg.style.display = 'none'; }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-input-wrapper')) sugg.style.display = 'none';
  });
}

function pickSuggestion(key, label) {
  document.getElementById('diseaseSearch').value = label;
  document.getElementById('searchSuggestions').style.display = 'none';
  selectedIllness = key;
  selectedBodyPart = null;
  markPill(key);
  searchHospitals();
}

function triggerSearch() {
  const q = (document.getElementById('diseaseSearch')?.value || '').trim().toLowerCase();
  if (!q) return;
  const match = allDiseases.find(d => d.label.toLowerCase() === q || d.key === q)
             || allDiseases.find(d => d.label.toLowerCase().includes(q));
  if (match) {
    selectedIllness = match.key;
    selectedBodyPart = null;
    markPill(match.key);
    searchHospitals();
  } else {
    selectedIllness = null;
    selectedBodyPart = null;
    doSearch({ custom_query: q });
  }
}

async function searchHospitals() {
  if (!userLat || !userLng) {
    showResults(`<div style="padding:24px; background:#eff6ff; border-radius:14px; color:#1e40af; text-align:center;">
      📍 Location needed to show hospitals.<br><br>
      <button onclick="refreshGPS()" style="background:#3b82f6;color:#fff;border:none;padding:10px 20px;border-radius:10px;cursor:pointer;font-weight:700;margin:4px;">
        📍 Use My GPS
      </button>
      <button onclick="showChangeLocationModal()" style="background:#f1f5f9;color:#374151;border:none;padding:10px 20px;border-radius:10px;cursor:pointer;font-weight:700;margin:4px;">
        ✏️ Enter Location
      </button>
    </div>`);
    return;
  }
  const radius = parseInt(document.getElementById('radiusSelect')?.value || 5000);
  await doSearch({ illness_type: selectedIllness, body_part: selectedBodyPart, radius });
}

async function doSearch({ illness_type, body_part, custom_query, radius }) {
  const r = radius || parseInt(document.getElementById('radiusSelect')?.value || 5000);
  showResults(`<div class="loading-overlay"><div class="spinner"></div><p style="color:var(--text-muted);font-weight:600;">Searching hospitals near you…</p></div>`);

  try {
    const res = await fetch('/api/search-hospitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: userLat, lng: userLng, radius: r,
        illness_type: illness_type || '',
        body_part:    body_part    || '',
        custom_query: custom_query || '',
        limit: 40
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderResults(data);
  } catch (e) {
    showResults(`<div style="padding:20px;background:#fef2f2;border-radius:12px;color:#991b1b;">❌ ${e.message}</div>`);
  }
}

function renderResults(data) {
  const hdr = document.getElementById('resultsHeader');
  if (hdr) hdr.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <h2 style="font-size:1.3rem;font-weight:800;">
        Results for <span style="color:var(--primary);">${data.search_label}</span>
      </h2>
      <span class="badge badge-primary">${data.total} found within ${data.radius_km} km</span>
    </div>`;

  if (!data.groups?.length) {
    showResults(`<div class="empty-state"><div class="empty-icon">🏥</div>
      <h3>No hospitals found</h3>
      <p>Try increasing the radius or <button onclick="showChangeLocationModal()" style="background:none;border:none;color:var(--primary);cursor:pointer;font-weight:700;padding:0;">change location</button></p>
    </div>`);
    return;
  }

  // Show map with all hospitals placed as markers
  const allH = data.groups.flatMap(g => g.hospitals);
  showMap(allH);

  showResults(data.groups.map(g => `
    <div style="margin-bottom:32px;">
      <div class="group-header">
        <span class="group-icon">${g.icon}</span>
        <span class="group-label">${g.label}</span>
        <span class="group-count">${g.hospitals.length}</span>
      </div>
      ${g.hospitals.map(h => hospitalCard(h)).join('')}
    </div>`).join(''));
}

function hospitalCard(h) {
  // clicking card opens directions in Google Maps
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`;
  const mapsQ   = encodeURIComponent(h.name + ' ' + (h.address || ''));
  const srcChip = h.source === 'database' ? `<span class="meta-chip source-db">✅ Verified</span>` : '';
  const rating  = h.display_rating > 0 ? `<span class="meta-chip">⭐ ${h.display_rating}</span>` : '';

  return `<div class="hospital-card" onclick="focusOnMap(${h.lat},${h.lng},'${h.name.replace(/'/g,"\\'")}','${(h.address||'').replace(/'/g,"\\'")}',${h.distance||0},'${h.phone||''}')">
    <div class="hospital-top">
      <div class="hospital-avatar">🏥</div>
      <div class="hospital-info">
        <div class="hospital-name">${h.name}</div>
        <div class="hospital-address">${h.address || 'Address not available'}</div>
      </div>
    </div>
    <div class="hospital-meta">
      <span class="meta-chip distance">📍 ${h.distance} km</span>
      <span class="meta-chip">${h.type || 'Hospital'}</span>
      ${rating}${srcChip}
      ${h.phone ? `<span class="meta-chip">📞 ${h.phone}</span>` : ''}
      <span class="meta-chip">${h.specialty_label || ''}</span>
    </div>
    <div class="hospital-actions" onclick="event.stopPropagation()">
      <a href="${mapsUrl}" target="_blank" class="btn btn-primary btn-sm">🗺️ Directions</a>
      <a href="https://www.google.com/maps/search/?api=1&query=${mapsQ}" target="_blank" class="btn btn-secondary btn-sm">📌 Map</a>
      ${h.phone ? `<a href="tel:${h.phone}" class="btn btn-secondary btn-sm">📞 Call</a>` : ''}
    </div>
  </div>`;
}

// Click card → pan map and open popup
function focusOnMap(lat, lng, name, address, distance, phone) {
  if (!mapplsMap || !mapReady) return;
  mapplsMap.setCenter([lat, lng]);
  mapplsMap.setZoom(16);
  // scroll to map
  document.getElementById('mapContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // open popup
  if (activePopup) { try { activePopup.close(); } catch(e){} }
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  try {
    activePopup = new mappls.InfoWindow({
      map:     mapplsMap,
      content: `<div style="font-size:13px;max-width:220px;line-height:1.6;padding:2px">
        <b style="font-size:14px">${name}</b><br>
        <span style="color:#555;font-size:12px">${address}</span><br>
        ${distance ? `<span style="color:#3b82f6">📏 ${distance} km away</span><br>` : ''}
        ${phone ? `📞 <a href="tel:${phone}" style="color:#007bff">${phone}</a><br>` : ''}
        <a href="${mapsUrl}" target="_blank"
           style="display:inline-block;margin-top:6px;padding:5px 12px;
                  background:#007bff;color:#fff;border-radius:6px;
                  text-decoration:none;font-size:12px;font-weight:600">
          🗺️ Get Directions
        </a>
      </div>`,
      position: [lat, lng],
    });
  } catch(e) {}
}

function showResults(html) {
  const el = document.getElementById('resultsContent');
  if (el) el.innerHTML = html;
}