import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { places as defaultPlaces, Place, Category, FoodCategory } from './data/places';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const STORAGE_KEY = 'yeosu-custom-places';
const YEOSU_CENTER: [number, number] = [34.7700, 127.7200];
const YEOSU_DEFAULT_ZOOM = 10;
const KOREA_OVERVIEW_CENTER: [number, number] = [36.25, 127.85];
const KOREA_OVERVIEW_ZOOM = 7;
const FOCUS_ZOOM = 16;
const NEON_COLOR = '#39ff14';
const YEOSU_BOUNDS: L.LatLngBoundsExpression = [[34.45, 127.30], [35.10, 128.20]];
const FOOD_CATEGORIES: FoodCategory[] = ['한식', '일식', '양식', '중식', '회·해산물', '카페', '디저트'];
const FOOD_MARKER_COLORS: Record<FoodCategory, string> = {
  '한식': '#dc2626',
  '일식': '#ef4444',
  '양식': '#f05252',
  '중식': '#b91c1c',
  '회·해산물': '#e11d48',
  '카페': '#c2410c',
  '디저트': '#e34b6f',
};

function loadCustomPlaces(): Place[] {
  try {
    // 숙소 카테고리는 제거됐으므로 이전에 저장된 숙소 항목은 걸러낸다.
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Place[]).filter(p => p.category === '관광명소' || p.category === '맛집');
  } catch { return []; }
}
function saveCustomPlaces(p: Place[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

/* ---------- icons ---------- */
function getPlaceColor(category: Category, foodCategory?: FoodCategory) {
  if (category === '맛집') return FOOD_MARKER_COLORS[foodCategory ?? '한식'];
  return '#2563eb';
}

function getPlaceColorLight(category: Category) {
  return category === '맛집' ? '#fff1f2' : '#eff6ff';
}

function createStarIcon(category: Category, foodCategory: FoodCategory | undefined, isActive: boolean, isCustom = false) {
  const fill = getPlaceColor(category, foodCategory);
  const stroke = isActive ? '#ffffff' : '#ffffff';
  const size   = isActive ? 38 : 30;
  const shadow = isActive ? 'drop-shadow(0 3px 8px rgba(26,111,168,0.55))' : 'drop-shadow(0 1px 4px rgba(0,0,0,0.18))';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
        fill="${fill}" stroke="${stroke}" stroke-width="1.5"
        style="filter:${shadow}"
      />
      ${isCustom ? `<circle cx="12" cy="12" r="2.5" fill="white" opacity="0.85"/>` : ''}
    </svg>`;
  return L.divIcon({
    html: svg, className: 'star-marker',
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

function createPinIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">
      <ellipse cx="15" cy="36" rx="5" ry="2" fill="rgba(0,0,0,0.12)"/>
      <path d="M15 2C8.37 2 3 7.37 3 14c0 8.25 12 22 12 22S27 22.25 27 14C27 7.37 21.63 2 15 2z"
        fill="#2b8fd4" stroke="white" stroke-width="1.5"/>
      <circle cx="15" cy="14" r="5" fill="white" opacity="0.9"/>
    </svg>`;
  return L.divIcon({
    html: svg, className: 'star-marker',
    iconSize: [30, 38], iconAnchor: [15, 36],
  });
}

/* ---------- map helpers ---------- */
/** 모든 장소를 같은 배율(FOCUS_ZOOM)로 비추고, 범위가 화면보다 큰 장소만 필요한 만큼 물러난다. */
function MapFlyTo({ place }: { place: Place | null }) {
  const map = useMap();
  useEffect(() => {
    if (!place) return;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const size = map.getSize();
    // 모바일은 하단 패널이 아래 절반을 가리므로 위쪽 영역에 맞추고 마커도 위로 올린다.
    const visible = L.point(size.x, mobile ? size.y * 0.45 : size.y);
    const bounds = place.outline ? L.latLngBounds(place.outline.coords) : null;
    const center = bounds ? bounds.getCenter() : L.latLng(place.lat, place.lng);

    let zoom = FOCUS_ZOOM;
    if (bounds) {
      while (zoom > 12) {
        const sw = map.project(bounds.getSouthWest(), zoom);
        const ne = map.project(bounds.getNorthEast(), zoom);
        if (Math.abs(ne.x - sw.x) + 64 <= visible.x && Math.abs(sw.y - ne.y) + 64 <= visible.y) break;
        zoom -= 1;
      }
    }
    const shift = mobile ? size.y * 0.22 : 0;
    const target = map.unproject(map.project(center, zoom).add([0, shift]), zoom);
    map.flyTo(target, zoom, { duration: 0.9 });
  }, [place, map]);
  return null;
}

function MapDragCollapse({ onDragStart }: { onDragStart: () => void }) {
  useMapEvents({ dragstart: onDragStart });
  return null;
}

function MapClickHandler({ active, onPick }: { active: boolean; onPick: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => { map.getContainer().style.cursor = active ? 'crosshair' : ''; }, [active, map]);
  useMapEvents({ click(e) { if (active) onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function MapViewport() {
  const map = useMap();

  useEffect(() => {
    const refresh = () => map.invalidateSize();
    const frame = window.requestAnimationFrame(refresh);
    window.addEventListener('resize', refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', refresh);
    };
  }, [map]);

  return null;
}

function InitialYeosuFocus() {
  const map = useMap();

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      map.once('moveend', () => {
        map.setMinZoom(10);
        map.setMaxBounds(YEOSU_BOUNDS);
      });
      map.flyTo(YEOSU_CENTER, YEOSU_DEFAULT_ZOOM, { duration: 1.6 });
    }, 450);

    return () => window.clearTimeout(focusTimer);
  }, [map]);

  return null;
}

function MapControls() {
  const map = useMap();
  const stopMapClick = (event: React.MouseEvent<HTMLButtonElement>) => event.stopPropagation();

  return (
    <div className="map-controls" aria-label="지도 조작">
      <button type="button" onMouseDown={stopMapClick} onClick={(event) => { stopMapClick(event); map.zoomIn(); }} aria-label="지도 확대">+</button>
      <button type="button" onMouseDown={stopMapClick} onClick={(event) => { stopMapClick(event); map.zoomOut(); }} aria-label="지도 축소">−</button>
      <button type="button" className="map-controls__home" onMouseDown={stopMapClick} onClick={(event) => { stopMapClick(event); map.flyTo(YEOSU_CENTER, YEOSU_DEFAULT_ZOOM, { duration: 0.6 }); }} aria-label="여수 중심으로 이동">
        여수
      </button>
    </div>
  );
}

/* ---------- types ---------- */
type SheetSnap = 'peek' | 'half' | 'full';
const SHEET_PEEK_HEIGHT = 92;

const emptyForm = {
  name: '', category: '관광명소' as Category,
  foodCategory: '한식' as FoodCategory,
  description: '', address: '', hours: '', tip: '', url: '',
};

/* ============================= App ============================= */
export default function App() {
  const [customPlaces, setCustomPlaces] = useState<Place[]>(loadCustomPlaces);
  const [selected, setSelected]         = useState<Place | null>(null);
  const [panelOpen, setPanelOpen]       = useState(false);
  const [sidebarOpen, setSidebarOpen]   = useState(false);
  const [filter, setFilter]             = useState<Category | 'all'>('all');
  const [foodFilter, setFoodFilter]     = useState<FoodCategory | 'all'>('all');
  const [addMode, setAddMode]           = useState(false);
  const [pinLatLng, setPinLatLng]       = useState<{ lat: number; lng: number } | null>(null);
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState(emptyForm);
  const [formError, setFormError]       = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Place | null>(null);
  const [sheetSnap, setSheetSnap]       = useState<SheetSnap>('half');
  const [dragH, setDragH]               = useState<number | null>(null);
  const [bodyH, setBodyH]               = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number; curH: number; moved: boolean } | null>(null);

  useEffect(() => {
    const update = () => setBodyH(bodyRef.current?.clientHeight ?? 0);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const snapHeights: Record<SheetSnap, number> = {
    peek: SHEET_PEEK_HEIGHT,
    half: Math.round(bodyH * 0.45),
    full: Math.round(bodyH * 0.88),
  };
  const sheetH = dragH ?? snapHeights[sheetSnap];
  const sheetHidden = addMode || (!!selected && panelOpen);

  function onHandleDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startH = snapHeights[sheetSnap];
    dragRef.current = { startY: e.clientY, startH, curH: startH, moved: false };
  }
  function onHandleMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    d.curH = Math.min(snapHeights.full, Math.max(snapHeights.peek, d.startH + dy));
    setDragH(d.curH);
  }
  function onHandleUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      setSheetSnap(s => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'));
    } else {
      const flick = d.curH - d.startH;
      const target = d.curH + Math.sign(flick) * 30; // small bias so a short flick still changes state
      const nearest = (Object.keys(snapHeights) as SheetSnap[]).reduce((a, b) =>
        Math.abs(snapHeights[a] - target) <= Math.abs(snapHeights[b] - target) ? a : b);
      setSheetSnap(nearest);
    }
    setDragH(null);
  }

  const allPlaces = [...defaultPlaces, ...customPlaces];
  const filtered  = allPlaces.filter(p =>
    (filter === 'all' || p.category === filter) &&
    (filter !== '맛집' || foodFilter === 'all' || p.foodCategory === foodFilter)
  );
  const isCustom  = (p: Place) => customPlaces.some(c => c.id === p.id);

  function handleSelect(place: Place) {
    if (addMode) return;
    setSelected(place); setPanelOpen(true);
  }
  function cancelAdd() {
    setAddMode(false); setShowForm(false); setPinLatLng(null); setForm(emptyForm); setFormError('');
  }
  function handleMapPick(lat: number, lng: number) {
    setPinLatLng({ lat, lng }); setShowForm(true); setForm(emptyForm); setFormError('');
  }
  function handleFormSubmit() {
    if (!form.name.trim())    { setFormError('장소명을 입력해주세요.'); return; }
    if (!form.address.trim()) { setFormError('주소를 입력해주세요.'); return; }
    if (!pinLatLng)           { setFormError('지도에서 위치를 선택해주세요.'); return; }
    const newPlace: Place = { id: Date.now(), ...form, lat: pinLatLng.lat, lng: pinLatLng.lng };
    const updated = [...customPlaces, newPlace];
    setCustomPlaces(updated); saveCustomPlaces(updated);
    cancelAdd(); setSelected(newPlace); setPanelOpen(true);
  }
  function handleDelete(place: Place) {
    const updated = customPlaces.filter(p => p.id !== place.id);
    setCustomPlaces(updated); saveCustomPlaces(updated); setDeleteTarget(null);
    if (selected?.id === place.id) { setSelected(null); setPanelOpen(false); }
  }

  /* ---- colours (CSS vars resolved inline for legibility) ---- */
  const C = {
    bg:      '#f7fafd',
    surface: '#ffffff',
    border:  '#dce8f2',
    blue:    '#1a6fa8',
    blueMid: '#2b8fd4',
    blueLt:  '#e8f3fb',
    teal:    '#0d9488',
    tealLt:  '#e6faf8',
    text:    '#0f2235',
    sub:     '#5b7a94',
    red:     '#d94f3d',
  } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: C.bg, fontFamily: 'var(--font-sans)' }}>

      {/* ── Header ── */}
      <header className="app-header" style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 60,
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        boxShadow: '0 1px 4px rgba(26,111,168,0.06)',
      }}>
        <div className="app-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #2b8fd4 0%, #0d9488 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
          }}>🗺</div>
          <div>
            <h1 style={{ fontFamily: 'var(--font-serif)', color: C.blue, fontSize: '1.15rem', fontWeight: 700, margin: 0, lineHeight: 1.1 }}>
              여수 지도
            </h1>
            <p className="app-subtitle" style={{ color: C.sub, fontSize: '0.7rem', margin: 0 }}>맛집 &amp; 관광명소 가이드</p>
          </div>
        </div>

        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Filter tabs */}
          <div className="category-filters" style={{ display: 'flex', gap: 4, background: C.blueLt, borderRadius: 10, padding: 4 }}>
            {(['all', '관광명소', '맛집'] as const).map(f => {
              const active = filter === f;
              return (
                <button key={f} onClick={() => { setFilter(f); setFoodFilter('all'); }} style={{
                  padding: '5px 13px', borderRadius: 7, fontSize: '0.78rem', fontWeight: 500,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: active ? C.surface : 'transparent',
                  color: active ? C.blue : C.sub,
                  boxShadow: active ? '0 1px 4px rgba(26,111,168,0.12)' : 'none',
                }}>
                  {f === 'all' ? '전체' : f}
                </button>
              );
            })}
          </div>

          {/* Add / Cancel */}
          {!addMode ? (
            <button className="add-place-button" onClick={() => { setAddMode(true); setPanelOpen(false); }} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 14px', borderRadius: 8,
              background: 'linear-gradient(135deg, #2b8fd4, #1a6fa8)',
              border: 'none', color: '#fff', fontSize: '0.82rem', fontWeight: 600,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(26,111,168,0.3)', transition: 'opacity 0.15s',
            }}>
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>＋</span><span>장소 등록</span>
            </button>
          ) : (
            <button onClick={cancelAdd} style={{
              padding: '7px 14px', borderRadius: 8,
              background: '#fff', border: `1px solid ${C.border}`,
              color: C.sub, fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
            }}>취소</button>
          )}
        </div>
      </header>

      {/* ── Add mode banner ── */}
      {addMode && !showForm && (
        <div style={{
          flexShrink: 0, padding: '9px 24px', textAlign: 'center',
          background: C.blueLt, borderBottom: `1px solid ${C.border}`,
          color: C.blue, fontSize: '0.83rem', fontWeight: 500,
        }}>
          📍 지도에서 등록할 위치를 클릭해주세요
        </div>
      )}

      {/* ── Body ── */}
      <div ref={bodyRef} className={`map-body ${sidebarOpen ? 'sidebar-open' : ''}`} style={{ flex: 1, overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <aside className={`sidebar-scroll place-sidebar ${sidebarOpen ? 'is-open' : ''} ${sheetHidden ? 'is-hidden' : ''} ${dragH !== null ? 'is-dragging' : ''}`} style={{
          width: 256, flexShrink: 0, overflowY: 'auto',
          background: C.surface, borderRight: `1px solid ${C.border}`,
          ['--sheet-h' as string]: `${sheetH}px`,
        }}>
          <div className="sheet-handle"
            onPointerDown={onHandleDown} onPointerMove={onHandleMove}
            onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
            role="button" aria-label="장소 목록 높이 조절">
            <span className="sheet-handle__bar" />
            <span className="sheet-handle__count">{filtered.length}곳의 장소</span>
          </div>
          <div style={{ padding: 12 }}>
            {filter === '맛집' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '4px 4px 12px' }}>
                {(['all', ...FOOD_CATEGORIES] as const).map(category => {
                  const active = foodFilter === category;
                  return (
                    <button key={category} onClick={() => setFoodFilter(category)} style={{
                      padding: '4px 8px', border: `1px solid ${active ? C.blueMid : C.border}`,
                      borderRadius: 20, background: active ? C.blueLt : '#fff', color: active ? C.blue : C.sub,
                      cursor: 'pointer', fontSize: '0.68rem', fontWeight: active ? 600 : 400,
                    }}>{category === 'all' ? '전체' : category}</button>
                  );
                })}
              </div>
            )}
            <p className="sheet-count-desktop" style={{ color: C.sub, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '4px 0 8px 4px' }}>
              {filtered.length}곳의 장소
            </p>
            {filtered.map(place => {
              const active = selected?.id === place.id;
              const food   = place.category === '맛집';
              const placeColor = getPlaceColor(place.category, place.foodCategory);
              return (
                <button key={place.id} onClick={() => { setSelected(place); setPanelOpen(true); if (addMode) cancelAdd(); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '9px 12px', marginBottom: 2, borderRadius: 9,
                    background: active ? C.blueLt : 'transparent',
                    border: active ? `1px solid ${C.border}` : '1px solid transparent',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                    <span style={{
                      fontSize: '1rem', width: 28, height: 28, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 7,
                      background: getPlaceColorLight(place.category),
                    }}>
                      {food ? '🍽' : '📍'}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: C.text, fontSize: '0.83rem', fontWeight: active ? 600 : 400, lineHeight: 1.25 }}>
                        {place.name}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        <Tag color={placeColor} bg={getPlaceColorLight(place.category)}>{place.category}</Tag>
                        {food && place.foodCategory && <Tag color={placeColor} bg={getPlaceColorLight(place.category)}>{place.foodCategory}</Tag>}
                        {isCustom(place) && <Tag color={C.sub} bg={C.bg}>내가 등록</Tag>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <button className={`sidebar-toggle ${sidebarOpen ? 'is-open' : ''}`} onClick={() => setSidebarOpen(open => !open)} aria-label={sidebarOpen ? '장소 목록 닫기' : '장소 목록 열기'}>
          {sidebarOpen ? '‹' : '☰'} <span>{sidebarOpen ? '닫기' : '목록'}</span>
        </button>

        {/* ── Map ── */}
        <div className="map-stage" style={{ position: 'relative' }}>
          <MapContainer
            center={KOREA_OVERVIEW_CENTER}
            zoom={KOREA_OVERVIEW_ZOOM}
            maxZoom={19}
            zoomControl={false}
            scrollWheelZoom
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapViewport />
            <InitialYeosuFocus />
            <MapFlyTo place={selected} />
            <MapDragCollapse onDragStart={() => setSheetSnap('peek')} />
            <MapClickHandler active={addMode && !showForm} onPick={handleMapPick} />
            {filtered.map(place => (
              <Marker key={place.id} position={[place.lat, place.lng]}
                icon={createStarIcon(place.category, place.foodCategory, selected?.id === place.id, isCustom(place))}
                eventHandlers={{ click: () => handleSelect(place) }}
              />
            ))}
            {filtered.map(place => {
              if (!place.outline) return null;
              const active = selected?.id === place.id;
              const pathOptions = {
                className: 'neon-outline', color: NEON_COLOR, fillColor: NEON_COLOR,
                weight: active ? 4 : 3, fillOpacity: active ? 0.3 : 0.14, opacity: active ? 1 : 0.9,
              };
              const eventHandlers = { click: () => handleSelect(place) };
              return place.outline.kind === 'line'
                ? <Polyline key={`outline-${place.id}-${active}`} positions={place.outline.coords} pathOptions={{ ...pathOptions, weight: active ? 6 : 4 }} eventHandlers={eventHandlers} />
                : <Polygon key={`outline-${place.id}-${active}`} positions={place.outline.coords} pathOptions={pathOptions} eventHandlers={eventHandlers} />;
            })}
            {pinLatLng && <Marker position={[pinLatLng.lat, pinLatLng.lng]} icon={createPinIcon()} />}
            <MapControls />
          </MapContainer>

          {/* Legend */}
          <div className="map-legend" style={{
            position: 'absolute', top: 14, left: 14, zIndex: 999,
            background: 'rgba(255,255,255,0.92)', border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '10px 14px',
            boxShadow: '0 2px 10px rgba(26,111,168,0.1)',
            backdropFilter: 'blur(6px)',
          }}>
            <p style={{ color: C.sub, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 6px' }}>범례</p>
            <LegendItem color="#dc2626" label="맛집" />
            <LegendItem color="#2563eb" label="관광명소" />
          </div>

          {/* Info panel */}
          {selected && panelOpen && !addMode && (
            <InfoPanel place={selected} isCustom={isCustom(selected)} C={C}
              onClose={() => setPanelOpen(false)} onDelete={() => setDeleteTarget(selected)} />
          )}

          {/* Add form */}
          {showForm && pinLatLng && (
            <AddFormPanel form={form} onChange={(f: string, v: string) => setForm(p => ({ ...p, [f]: v }))}
              onSubmit={handleFormSubmit} onCancel={cancelAdd}
              onRepin={() => setShowForm(false)}
              error={formError} lat={pinLatLng.lat} lng={pinLatLng.lng} C={C} />
          )}
        </div>
      </div>

      {/* Delete modal */}
      {deleteTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(15,34,53,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: 28, width: 320, textAlign: 'center',
            boxShadow: '0 16px 48px rgba(26,111,168,0.18)',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: 10 }}>🗑</div>
            <h3 style={{ color: C.text, fontFamily: 'var(--font-serif)', margin: '0 0 8px', fontSize: '1.05rem' }}>
              장소를 삭제할까요?
            </h3>
            <p style={{ color: C.sub, fontSize: '0.82rem', margin: '0 0 20px' }}>
              <strong style={{ color: C.text }}>{deleteTarget.name}</strong>을(를) 삭제하면 복구할 수 없습니다.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} style={{
                flex: 1, padding: '9px 0', borderRadius: 8,
                background: 'transparent', border: `1px solid ${C.border}`,
                color: C.sub, cursor: 'pointer', fontSize: '0.85rem',
              }}>취소</button>
              <button onClick={() => handleDelete(deleteTarget)} style={{
                flex: 1, padding: '9px 0', borderRadius: 8,
                background: '#fff1f0', border: '1px solid #fca5a5',
                color: C.red, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
              }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Info Panel ── */
function InfoPanel({ place, isCustom, C, onClose, onDelete }: {
  place: Place; isCustom: boolean; C: any; onClose: () => void; onDelete: () => void;
}) {
  const food = place.category === '맛집';
  const placeColor = getPlaceColor(place.category, place.foodCategory);
  return (
    <div className="sidebar-scroll info-panel" style={{
      position: 'absolute', bottom: 20, right: 20, width: 340, maxHeight: 'calc(100% - 40px)', overflowY: 'auto',
      background: '#fff', border: `1px solid ${C.border}`,
      borderRadius: 14, padding: 24, zIndex: 1000,
      boxShadow: '0 8px 32px rgba(26,111,168,0.14)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <Tag color={placeColor} bg={getPlaceColorLight(place.category)}>★ {place.category}</Tag>
          {food && place.foodCategory && <Tag color={placeColor} bg={getPlaceColorLight(place.category)}>{place.foodCategory}</Tag>}
          {isCustom && <Tag color={C.sub} bg={C.bg}>내가 등록</Tag>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isCustom && (
            <button onClick={onDelete} style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5',
              background: '#fff1f0', color: C.red, fontSize: '0.73rem', cursor: 'pointer',
            }}>삭제</button>
          )}
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: '50%', border: `1px solid ${C.border}`,
            background: '#fff', color: C.sub, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem',
          }}>✕</button>
        </div>
      </div>

      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 700, color: C.text, margin: '0 0 10px' }}>
        {place.name}
      </h2>
      <p style={{ color: C.sub, fontSize: '0.83rem', lineHeight: 1.75, margin: '0 0 16px' }}>
        {place.description}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <InfoRow icon="📍" label="주소" value={place.address} C={C} />
        {place.hours && <InfoRow icon="🕐" label="운영시간" value={place.hours} C={C} />}
        {place.tip   && <InfoRow icon="💡" label="여행 팁"  value={place.tip}   C={C} accent />}
      </div>

      {place.url && (
        <a href={place.url} target="_blank" rel="noopener noreferrer" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          marginTop: 18, padding: '10px 0', borderRadius: 9,
          background: 'linear-gradient(135deg, #2b8fd4, #1a6fa8)',
          color: '#fff', fontSize: '0.83rem', fontWeight: 600, textDecoration: 'none',
          boxShadow: '0 2px 8px rgba(26,111,168,0.25)',
        }}>
          🔗 자세히 보기
        </a>
      )}
    </div>
  );
}

/* ── Add Form Panel ── */
function AddFormPanel({ form, onChange, onSubmit, onCancel, onRepin, error, lat, lng, C }: any) {
  return (
    <div className="sidebar-scroll add-form-panel" style={{
      position: 'absolute', top: 14, right: 14, width: 340,
      maxHeight: 'calc(100% - 28px)', overflowY: 'auto',
      background: '#fff', border: `1px solid ${C.border}`,
      borderRadius: 14, padding: 22, zIndex: 1000,
      boxShadow: '0 8px 32px rgba(26,111,168,0.14)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', color: C.blue, fontSize: '1.05rem', margin: 0 }}>장소 등록</h3>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', fontSize: '1rem' }}>✕</button>
      </div>

      {/* Coords */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', borderRadius: 8, marginBottom: 14,
        background: C.blueLt, border: `1px solid ${C.border}`,
      }}>
        <span style={{ color: C.blue, fontSize: '0.78rem' }}>
          📍 {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <button onClick={onRepin} style={{
          background: 'none', border: 'none', color: C.blueMid,
          fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline',
        }}>위치 다시 선택</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <Field label="장소명 *">
          <Input value={form.name} onChange={v => onChange('name', v)} placeholder="예) 여수 진남관" C={C} />
        </Field>

        <Field label="카테고리">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['관광명소', '맛집'] as const).map(cat => {
              const on = form.category === cat;
              const food = cat === '맛집';
              return (
                <button key={cat} onClick={() => onChange('category', cat)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
                  fontSize: '0.82rem', fontWeight: 500, transition: 'all 0.13s', border: 'none',
                  background: on ? (food ? C.blueLt : C.tealLt) : '#f4f7fa',
                  color: on ? (food ? C.blue : C.teal) : C.sub,
                  outline: on ? `2px solid ${food ? C.blueMid : C.teal}` : '2px solid transparent',
                }}>
                  {food ? '🍽 맛집' : '📍 관광명소'}
                </button>
              );
            })}
          </div>
        </Field>

        {form.category === '맛집' && (
          <Field label="음식 종류">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FOOD_CATEGORIES.map(category => {
                const active = form.foodCategory === category;
                return (
                  <button key={category} onClick={() => onChange('foodCategory', category)} style={{
                    padding: '6px 9px', borderRadius: 20, cursor: 'pointer', fontSize: '0.75rem',
                    border: `1px solid ${active ? C.blueMid : C.border}`,
                    background: active ? C.blueLt : '#fff', color: active ? C.blue : C.sub,
                  }}>{category}</button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="주소 *">
          <Input value={form.address} onChange={v => onChange('address', v)} placeholder="예) 전라남도 여수시 …" C={C} />
        </Field>
        <Field label="설명">
          <Textarea value={form.description} onChange={v => onChange('description', v)} placeholder="장소에 대한 간단한 설명" C={C} />
        </Field>
        <Field label="운영시간">
          <Input value={form.hours} onChange={v => onChange('hours', v)} placeholder="예) 09:00–21:00 (월요일 휴무)" C={C} />
        </Field>
        <Field label="여행 팁">
          <Input value={form.tip} onChange={v => onChange('tip', v)} placeholder="방문자에게 전하는 팁" C={C} />
        </Field>
        <Field label="URL / 링크">
          <Input value={form.url} onChange={v => onChange('url', v)} placeholder="https://…" C={C} />
        </Field>
      </div>

      {error && (
        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 8,
          background: '#fff1f0', border: '1px solid #fca5a5', color: C.red, fontSize: '0.8rem',
        }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onCancel} style={{
          flex: 1, padding: '10px 0', borderRadius: 8,
          background: 'transparent', border: `1px solid ${C.border}`,
          color: C.sub, cursor: 'pointer', fontSize: '0.83rem',
        }}>취소</button>
        <button onClick={onSubmit} style={{
          flex: 2, padding: '10px 0', borderRadius: 8,
          background: 'linear-gradient(135deg, #2b8fd4, #1a6fa8)',
          border: 'none', color: '#fff', cursor: 'pointer',
          fontSize: '0.83rem', fontWeight: 600,
          boxShadow: '0 2px 8px rgba(26,111,168,0.25)',
        }}>등록하기</button>
      </div>
    </div>
  );
}

/* ── Small shared components ── */
function Tag({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      fontSize: '0.67rem', fontWeight: 500, background: bg, color,
    }}>{children}</span>
  );
}

function InfoRow({ icon, label, value, C, accent }: { icon: string; label: string; value: string; C: any; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <span style={{ fontSize: '0.85rem', flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <div style={{ color: '#9ab0c2', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 1 }}>{label}</div>
        <div style={{ color: accent ? C.blue : C.sub, fontSize: '0.81rem', lineHeight: 1.55, fontWeight: accent ? 500 : 400 }}>{value}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', color: '#9ab0c2', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const sharedInputStyle = (C: any): React.CSSProperties => ({
  width: '100%', padding: '9px 12px', borderRadius: 8,
  background: '#f7fafd', border: `1px solid ${C.border}`,
  color: C.text, fontSize: '0.83rem', fontFamily: 'var(--font-sans)',
  boxSizing: 'border-box', transition: 'border-color 0.15s, box-shadow 0.15s',
});

function Input({ value, onChange, placeholder, C }: { value: string; onChange: (v: string) => void; placeholder: string; C: any }) {
  return <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={sharedInputStyle(C)} />;
}

function Textarea({ value, onChange, placeholder, C }: { value: string; onChange: (v: string) => void; placeholder: string; C: any }) {
  return <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} style={{ ...sharedInputStyle(C), resize: 'vertical' }} />;
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <svg width="13" height="13" viewBox="0 0 24 24">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill={color} />
      </svg>
      <span style={{ color: '#5b7a94', fontSize: '0.74rem' }}>{label}</span>
    </div>
  );
}

export { emptyForm };
