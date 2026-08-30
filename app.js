/* =========================================================================
   DOG-GO TRACKER — Uygulama Mantığı
   Backend: Google Apps Script Web App (Code.gs) + Google Sheets
   Offline: localStorage üzerinden yedekleme / bekleyen kuyruk (pending queue)
   ========================================================================= */

const CONFIG = {
  // Google Apps Script "Web App" deploy URL'ini buraya yapıştırabilirsin
  // YA DA sağ üstteki Ayarlar ikonundan uygulama içinden girip kaydedebilirsin.
  API_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE"
};
{
  const savedUrl = localStorage.getItem('dgt_api_url');
  if(savedUrl) CONFIG.API_URL = savedUrl;
}

const LS = {
  ANIMALS: 'dgt_animals',
  ACTIVITIES: 'dgt_activities',
  ACTIVE: 'dgt_active_animal',
  QUEUE: 'dgt_pending_queue'
};

const AVATARS = ['🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐇','🐾'];

function uid(prefix){ return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function todayISO(){ const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function walkerLabel(name){ return name==='Eşim' ? 'Tracy' : name; }
function sortActivitiesDesc(arr){
  // En yeni aktivite en üstte: önce tarihe, eşitse AktiviteID'ye (oluşturulma sırasına) göre azalan sıralama.
  return arr.slice().sort((a,b)=>{
    const da = parseLocalDate(a.Tarih)?.getTime() || 0;
    const db = parseLocalDate(b.Tarih)?.getTime() || 0;
    if(db !== da) return db - da;
    return String(b.AktiviteID).localeCompare(String(a.AktiviteID));
  });
}
function parseLocalDate(str){
  // "YYYY-MM-DD" metnini YEREL saat diliminde ayrıştırır (new Date(str) UTC varsayar,
  // bu da saat dilimine göre günün kaymasına ve filtrelerin yanlış çalışmasına yol açar).
  if(!str) return null;
  const parts = String(str).slice(0,10).split('-').map(Number);
  if(parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1]-1, parts[2]);
}

/* ---------------- Local storage helpers ---------------- */
const Store = {
  get(key, fallback){ try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }catch(e){ return fallback; } },
  set(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
};

let STATE = {
  animals: Store.get(LS.ANIMALS, []),
  activities: Store.get(LS.ACTIVITIES, []),
  activeAnimalId: Store.get(LS.ACTIVE, null),
  range: 'week'
};

/* ---------------- API layer (Apps Script) ----------------
   Not: Google Apps Script Web App'lerinde CORS preflight sorunlarından
   kaçınmak için POST isteklerinde 'text/plain' content-type kullanılır. */
const Api = {
  get configured(){ return CONFIG.API_URL && !CONFIG.API_URL.startsWith('PASTE_'); },

  async fetchAll(){
    if(!this.configured) return null;
    try{
      const res = await fetch(CONFIG.API_URL + '?action=getData');
      const data = await res.json();
      if(data && data.ok){
        STATE.animals = data.animals || [];
        STATE.activities = data.activities || [];
        Store.set(LS.ANIMALS, STATE.animals);
        Store.set(LS.ACTIVITIES, STATE.activities);
        return data;
      }
      console.warn('Apps Script yanıtı beklenmeyen formatta:', data);
      Toast.show('Sheets\'ten veri gelmedi — Ayarlar > Test Et ile kontrol et');
    }catch(e){
      console.warn('Apps Script erişilemedi, localStorage kullanılıyor.', e);
      Toast.show('Sheets\'e bağlanılamadı — Ayarlar > Test Et ile kontrol et');
    }
    return null;
  },

  async send(action, payload){
    if(!this.configured){ Queue.push(action, payload); return {ok:false, offline:true}; }
    try{
      const res = await fetch(CONFIG.API_URL, {
        method:'POST',
        headers:{ 'Content-Type':'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload })
      });
      const data = await res.json();
      if(!data.ok) Queue.push(action, payload);
      return data;
    }catch(e){
      Queue.push(action, payload);
      return {ok:false, offline:true};
    }
  }
};

const Queue = {
  push(action, payload){
    const q = Store.get(LS.QUEUE, []);
    q.push({ action, payload, ts: Date.now() });
    Store.set(LS.QUEUE, q);
  },
  async flush(){
    if(!Api.configured) return;
    let q = Store.get(LS.QUEUE, []);
    if(!q.length) return;
    const remaining = [];
    for(const item of q){
      try{
        const res = await fetch(CONFIG.API_URL, {
          method:'POST',
          headers:{ 'Content-Type':'text/plain;charset=utf-8' },
          body: JSON.stringify({ action:item.action, payload:item.payload })
        });
        const data = await res.json();
        if(!data.ok) remaining.push(item);
      }catch(e){ remaining.push(item); }
    }
    Store.set(LS.QUEUE, remaining);
    if(remaining.length < q.length) Toast.show('Bekleyen kayıtlar senkronize edildi ✓');
  }
};
window.addEventListener('online', ()=>Queue.flush());

/* ---------------- Toast ---------------- */
const Toast = {
  show(msg){
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('opacity-0','pointer-events-none');
    el.classList.add('opacity-100');
    clearTimeout(this._t);
    this._t = setTimeout(()=>{ el.classList.add('opacity-0','pointer-events-none'); el.classList.remove('opacity-100'); }, 2200);
  }
};

/* ---------------- Sheets (bottom sheets) ---------------- */
const Sheets = {
  open(id){
    document.getElementById('overlay').classList.add('show');
    document.getElementById(id).classList.add('show');
  },
  close(id){
    document.getElementById(id).classList.remove('show');
    if(!document.querySelector('.bottom-sheet.show')) document.getElementById('overlay').classList.remove('show');
  },
  closeAll(){
    document.querySelectorAll('.bottom-sheet.show').forEach(s=>s.classList.remove('show'));
    document.getElementById('overlay').classList.remove('show');
  }
};

/* ---------------- Settings (Apps Script bağlantısı) ---------------- */
const Settings = {
  setStatus(msg, kind){
    const el = document.getElementById('settingsStatus');
    el.textContent = msg || '';
    el.className = 'text-xs mt-2 min-h-[16px] ' + (kind==='ok' ? 'text-moss' : kind==='err' ? 'text-coral' : 'text-inkmut');
  },
  open(){
    document.getElementById('apiUrlInput').value = Api.configured ? CONFIG.API_URL : '';
    this.setStatus('');
    Sheets.open('settingsSheet');
  },
  async test(){
    const url = document.getElementById('apiUrlInput').value.trim();
    if(!url){ this.setStatus('Önce bir URL gir.', 'err'); return; }
    this.setStatus('Test ediliyor…');
    try{
      const res = await fetch(url + '?action=getData');
      const data = await res.json();
      if(data && data.ok){
        this.setStatus(`Bağlantı başarılı ✓ (${data.animals?.length||0} hayvan, ${data.activities?.length||0} aktivite)`, 'ok');
      } else {
        this.setStatus('Bağlandı ama beklenmeyen bir yanıt geldi. Code.gs doğru deploy edilmiş mi kontrol et.', 'err');
      }
    }catch(e){
      this.setStatus('Bağlanılamadı. URL doğru mu ve "Anyone" erişimiyle deploy edildi mi kontrol et.', 'err');
    }
  },
  async save(){
    const url = document.getElementById('apiUrlInput').value.trim();
    if(!url || !url.startsWith('http')){ this.setStatus('Geçerli bir URL gir (https:// ile başlamalı).', 'err'); return; }
    localStorage.setItem('dgt_api_url', url);
    CONFIG.API_URL = url;
    this.setStatus('Kaydedildi, senkronize ediliyor…', 'ok');
    await Api.fetchAll();
    await Queue.flush();
    Header.render();
    Dashboard.render();
    Toast.show('Ayarlar kaydedildi ✓');
    Sheets.close('settingsSheet');
  },
  clear(){
    localStorage.removeItem('dgt_api_url');
    CONFIG.API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
    document.getElementById('apiUrlInput').value = '';
    this.setStatus('Bağlantı kaldırıldı, veriler artık sadece bu cihazda tutulacak.', 'ok');
    Toast.show('Apps Script bağlantısı kaldırıldı');
  }
};

/* ---------------- Navigation ---------------- */
const Nav = {
  current: 'dashboard',
  go(screen){
    if(!STATE.animals.length && screen !== 'empty'){ screen = 'empty'; }
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById('screen-'+screen).classList.add('active');
    document.getElementById('bottomNav').style.display = (screen==='live') ? 'none' : 'block';
    document.querySelectorAll('.nav-icon').forEach(b=>b.classList.toggle('active', b.dataset.nav===screen));
    const titles = { dashboard:'Anasayfa', analytics:'Analiz', empty:'Başla' };
    if(titles[screen]){ document.getElementById('screenTitle').textContent = titles[screen]; }
    document.getElementById('backBtn').classList.toggle('hidden', screen!=='live');
    this.current = screen;
    if(screen==='dashboard') Dashboard.render();
    if(screen==='analytics') Analytics.render();
  },
  back(){ this.go('dashboard'); }
};

/* ---------------- Animals module ---------------- */
const Animals = {
  active(){ return STATE.animals.find(a=>a.HayvanID===STATE.activeAnimalId) || STATE.animals[0]; },

  formatAge(dogumTarihi){
    if(!dogumTarihi) return '';
    const b = new Date(dogumTarihi), t = new Date();
    if(isNaN(b.getTime())) return '';
    let months = (t.getFullYear()-b.getFullYear())*12 + (t.getMonth()-b.getMonth());
    if(t.getDate() < b.getDate()) months--;
    if(months < 0) months = 0;
    if(months < 12) return months + ' aylık';
    const years = Math.floor(months/12);
    return years + ' yaş';
  },

  renderSwitcher(){
    const wrap = document.getElementById('animalList');
    wrap.innerHTML = STATE.animals.map(a=>`
      <div class="flex items-center gap-3 p-3 rounded-card border ${a.HayvanID===STATE.activeAnimalId ? 'border-violet bg-violet-soft' : 'border-mist bg-white'}">
        <button onclick="Animals.setActive('${a.HayvanID}')" class="flex items-center gap-3 flex-1 text-left">
          <span class="w-11 h-11 rounded-full bg-mist flex items-center justify-center text-xl">${a.Avatar||'🐕'}</span>
          <span>
            <span class="block font-display font-bold text-ink text-sm">${a.Isim}</span>
            <span class="block text-xs text-inkmut">${a.Tur||'Köpek'} ${Animals.formatAge(a.DogumTarihi)?('· '+Animals.formatAge(a.DogumTarihi)):''}</span>
          </span>
        </button>
        <button onclick="Animals.editForm('${a.HayvanID}')" class="w-8 h-8 rounded-full flex items-center justify-center active:bg-mist">
          <svg viewBox="0 0 24 24" class="w-4 h-4 stroke-inkmut" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
        </button>
      </div>
    `).join('') || `<p class="text-sm text-inkmut text-center py-4">Henüz dost eklenmedi.</p>`;
  },

  setActive(id){
    STATE.activeAnimalId = id;
    Store.set(LS.ACTIVE, id);
    Sheets.close('animalSheet');
    Header.render();
    Dashboard.render();
    if(Nav.current==='analytics') Analytics.render();
  },

  openAddForm(){
    document.getElementById('animalForm').reset();
    document.getElementById('animalForm').hayvanId.value = '';
    document.getElementById('animalFormTitle').textContent = 'Yeni Dost Ekle';
    document.getElementById('deleteAnimalBtn').classList.add('hidden');
    document.getElementById('ageHint').textContent = '';
    this.buildAvatarPicker(AVATARS[0]);
  },

  editForm(id){
    const a = STATE.animals.find(x=>x.HayvanID===id);
    if(!a) return;
    Sheets.close('animalSheet');
    const f = document.getElementById('animalForm');
    f.hayvanId.value = a.HayvanID;
    f.isim.value = a.Isim;
    f.tur.value = a.Tur || 'Köpek';
    f.dogumTarihi.value = a.DogumTarihi || '';
    document.getElementById('ageHint').textContent = a.DogumTarihi ? ('Yaş: ' + Animals.formatAge(a.DogumTarihi)) : '';
    document.getElementById('animalFormTitle').textContent = 'Dostu Düzenle';
    document.getElementById('deleteAnimalBtn').classList.remove('hidden');
    this.buildAvatarPicker(a.Avatar || AVATARS[0]);
    Sheets.open('animalFormSheet');
  },

  buildAvatarPicker(selected){
    const wrap = document.getElementById('avatarPicker');
    wrap.dataset.selected = selected;
    wrap.innerHTML = AVATARS.map(av=>`
      <button type="button" onclick="Animals.pickAvatar('${av}')"
        class="avatar-opt w-10 h-10 rounded-full flex items-center justify-center text-lg ${av===selected?'bg-violet-soft ring-2 ring-violet':'bg-mist'}">${av}</button>
    `).join('');
  },
  pickAvatar(av){
    const wrap = document.getElementById('avatarPicker');
    wrap.dataset.selected = av;
    [...wrap.children].forEach(btn=>{
      const on = btn.textContent.trim()===av;
      btn.className = 'avatar-opt w-10 h-10 rounded-full flex items-center justify-center text-lg ' + (on?'bg-violet-soft ring-2 ring-violet':'bg-mist');
    });
  },

  async submitForm(e){
    e.preventDefault();
    const f = e.target;
    const id = f.hayvanId.value || uid('hyv');
    const record = {
      HayvanID: id,
      Isim: f.isim.value.trim(),
      Tur: f.tur.value,
      DogumTarihi: f.dogumTarihi.value,
      Avatar: document.getElementById('avatarPicker').dataset.selected || '🐕'
    };
    const isNew = !f.hayvanId.value;
    if(isNew) STATE.animals.push(record);
    else STATE.animals = STATE.animals.map(a=>a.HayvanID===id?record:a);

    Store.set(LS.ANIMALS, STATE.animals);
    if(isNew || !STATE.activeAnimalId) { STATE.activeAnimalId = id; Store.set(LS.ACTIVE, id); }

    await Api.send(isNew ? 'addAnimal' : 'updateAnimal', record);
    Sheets.close('animalFormSheet');
    Toast.show(isNew ? 'Dost eklendi 🐾' : 'Bilgiler güncellendi');
    Header.render();
    Nav.go(STATE.animals.length ? (Nav.current==='empty'?'dashboard':Nav.current) : 'empty');
  },

  async deleteCurrentForm(){
    const id = document.getElementById('animalForm').hayvanId.value;
    if(!id) return;
    if(!confirm('Bu dostu ve tüm aktivite geçmişini silmek istediğine emin misin?')) return;
    STATE.animals = STATE.animals.filter(a=>a.HayvanID!==id);
    STATE.activities = STATE.activities.filter(a=>a.HayvanID!==id);
    Store.set(LS.ANIMALS, STATE.animals);
    Store.set(LS.ACTIVITIES, STATE.activities);
    if(STATE.activeAnimalId===id) STATE.activeAnimalId = STATE.animals[0]?.HayvanID || null;
    Store.set(LS.ACTIVE, STATE.activeAnimalId);
    await Api.send('deleteAnimal', {HayvanID:id});
    Sheets.close('animalFormSheet');
    Toast.show('Dost silindi');
    Header.render();
    Nav.go(STATE.animals.length ? 'dashboard' : 'empty');
  }
};

/* ---------------- Header ---------------- */
const Header = {
  render(){
    const a = Animals.active();
    document.getElementById('activeAvatar').textContent = a ? (a.Avatar||'🐕') : '🐾';
    document.getElementById('activeName').textContent = a ? a.Isim : 'Dost ekle';
    Animals.renderSwitcher();
  }
};

/* ---------------- Forms: manual entry ---------------- */
const Forms = {
  openManual(){
    if(!Animals.active()){ Toast.show('Önce bir dost eklemelisin'); Sheets.open('animalFormSheet'); return; }
    document.getElementById('manualForm').reset();
    document.getElementById('manualForm').tarih.value = todayISO();
    Sheets.open('manualSheet');
  },
  async submitManual(e){
    e.preventDefault();
    const f = e.target;
    const active = Animals.active();
    const record = {
      AktiviteID: uid('akt'),
      HayvanID: active.HayvanID,
      Tarih: f.tarih.value,
      SureDakika: Number(f.sure.value),
      MesafeKm: Number(f.mesafe.value),
      GezdirenKisi: f.gezdiren.value,
      Tip: 'Manuel',
      Notlar: f.notlar.value,
      RotaKoordinatlari: ''
    };
    STATE.activities.unshift(record);
    Store.set(LS.ACTIVITIES, STATE.activities);
    await Api.send('addActivity', record);
    Sheets.close('manualSheet');
    Toast.show('Yürüyüş kaydedildi ✓');
    Dashboard.render();
    if(Nav.current==='analytics') Analytics.render();
  }
};

/* ---------------- Wake Lock (takip sırasında ekranın kilitlenmesini engeller) ----------------
   Not: Bu sadece ekranın OTOMATİK uyumasını engeller. Kullanıcı ekranı elle kilitlerse veya
   tarayıcı sekmesi arka plana alınırsa, tarayıcılar güvenlik/pil nedeniyle JS'i ve GPS
   takibini durdurur — bu web ortamında aşılamayan bir platform kısıtlamasıdır. */
const WakeLock = {
  sentinel: null,
  async request(){
    try{
      if('wakeLock' in navigator){
        this.sentinel = await navigator.wakeLock.request('screen');
      }
    }catch(e){ console.warn('Wake Lock alınamadı', e); }
  },
  async release(){
    try{ if(this.sentinel){ await this.sentinel.release(); this.sentinel = null; } }catch(e){}
  }
};
document.addEventListener('visibilitychange', async ()=>{
  if(document.visibilityState === 'hidden' && Live.timerInt && !Live.paused){
    Live._wasBackgrounded = true;
  }
  if(document.visibilityState === 'visible' && Live._wasBackgrounded){
    Live._wasBackgrounded = false;
    if(Live.timerInt){
      await WakeLock.request();
      Toast.show('Tekrar hoş geldin — tarayıcı arka planda takibi durdurmuş olabilir, rotanı kontrol et');
    }
  }
});

/* ---------------- Live tracking module ---------------- */
const Live = {
  map:null, polyline:null, marker:null, watchId:null,
  coords:[], seconds:0, distanceKm:0, timerInt:null, paused:false, lastFix:null,
  selectedWalker:'Ben', _wasBackgrounded:false,

  openWalkerPicker(){
    if(!Animals.active()){ Toast.show('Önce bir dost eklemelisin'); Sheets.open('animalFormSheet'); return; }
    document.getElementById('liveWalkerSelect').value = this.selectedWalker || 'Ben';
    Sheets.open('liveWalkerSheet');
  },
  confirmStart(){
    this.selectedWalker = document.getElementById('liveWalkerSelect').value;
    Sheets.close('liveWalkerSheet');
    this.start();
  },

  start(){
    if(!Animals.active()){ Toast.show('Önce bir dost eklemelisin'); Sheets.open('animalFormSheet'); return; }
    this.coords=[]; this.seconds=0; this.distanceKm=0; this.paused=false; this.lastFix=null;
    document.getElementById('liveTimer').textContent='00:00';
    document.getElementById('liveDistance').innerHTML='0.00 <span class="text-sm">km</span>';
    document.getElementById('livePauseBtn').textContent='Duraklat';
    document.getElementById('bottomNav').style.display='none';
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById('screen-live').classList.add('active');
    Nav.current='live';
    this.setStatus('Konumun aranıyor…');

    setTimeout(()=>{
      if(!this.map){
        this.map = L.map('liveMap', {zoomControl:false}).setView([41.3874,2.1686], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, subdomains:'abc'}).addTo(this.map);
        this.polyline = L.polyline([], {color:'#F14C6B', weight:6, opacity:0.9, lineCap:'round', lineJoin:'round'}).addTo(this.map);
      } else { this.map.invalidateSize(); }

      if(!navigator.geolocation){
        this.setStatus('Bu cihaz/tarayıcı konum servisini desteklemiyor');
        Toast.show('Konum servisi desteklenmiyor, manuel giriş kullanabilirsin');
        return;
      }

      navigator.geolocation.getCurrentPosition(
        pos => { this.map.setView([pos.coords.latitude, pos.coords.longitude], 17); this.onFix(pos); },
        err => this.handleGeoError(err),
        { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
      );

      this.watchId = navigator.geolocation.watchPosition(
        pos => this.onFix(pos),
        err => this.handleGeoError(err),
        { enableHighAccuracy:true, maximumAge:2000, timeout:10000 }
      );
    }, 60);

    this.timerInt = setInterval(()=>{ if(!this.paused){ this.seconds++; this.renderTimer(); } }, 1000);
    WakeLock.request();
  },

  setStatus(msg){
    const el = document.getElementById('liveStatusBadge');
    if(!msg){ el.classList.add('hidden'); return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  handleGeoError(err){
    console.warn(err);
    const messages = {
      1: 'Konum izni reddedildi. Tarayıcı ayarlarından konuma izin ver.',
      2: 'Konum şu anda alınamıyor. Açık alanda tekrar dene.',
      3: 'Konum isteği zaman aşımına uğradı, tekrar deneniyor…'
    };
    this.setStatus(messages[err.code] || 'Konum alınamadı');
    if(err.code === 1) Toast.show('Konum izni verilmedi — manuel giriş kullanabilirsin');
  },

  onFix(pos){
    const {latitude, longitude} = pos.coords;
    this.setStatus(null);
    if(this.paused) return;
    if(this.lastFix){
      this.distanceKm += this.haversine(this.lastFix.latitude, this.lastFix.longitude, latitude, longitude);
      document.getElementById('liveDistance').innerHTML = this.distanceKm.toFixed(2)+' <span class="text-sm">km</span>';
    }
    this.lastFix = {latitude, longitude};
    this.coords.push([latitude, longitude]);
    if(this.map){
      this.polyline.addLatLng([latitude, longitude]);
      if(!this.marker){
        const icon = L.divIcon({html:'<div style="width:16px;height:16px;border-radius:50%;background:#1689B2;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>', className:'', iconSize:[16,16]});
        this.marker = L.marker([latitude, longitude], {icon}).addTo(this.map);
      } else { this.marker.setLatLng([latitude, longitude]); }
      this.map.panTo([latitude, longitude]);
    }
  },

  haversine(lat1, lon1, lat2, lon2){
    const R=6371, toRad=d=>d*Math.PI/180;
    const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R * 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  renderTimer(){
    const m = String(Math.floor(this.seconds/60)).padStart(2,'0');
    const s = String(this.seconds%60).padStart(2,'0');
    document.getElementById('liveTimer').textContent = `${m}:${s}`;
  },

  togglePause(){
    this.paused = !this.paused;
    document.getElementById('livePauseBtn').textContent = this.paused ? 'Devam Et' : 'Duraklat';
  },

  cancel(){
    if(!confirm('Canlı takibi iptal etmek istediğine emin misin? Kayıt tutulmayacak.')) return;
    this.teardown();
    Nav.go('dashboard');
  },

  confirmFinish(){
    Sheets.open('finishConfirmSheet');
  },

  async finish(){
    this.teardown();
    const active = Animals.active();
    const record = {
      AktiviteID: uid('akt'),
      HayvanID: active.HayvanID,
      Tarih: todayISO(),
      SureDakika: Math.max(1, Math.round(this.seconds/60)),
      MesafeKm: Number(this.distanceKm.toFixed(2)),
      GezdirenKisi: this.selectedWalker || 'Ben',
      Tip: 'Canli',
      Notlar: '',
      RotaKoordinatlari: JSON.stringify(this.coords)
    };
    STATE.activities.unshift(record);
    Store.set(LS.ACTIVITIES, STATE.activities);
    await Api.send('addActivity', record);
    Nav.go('dashboard');
    Toast.show('Yürüyüş kaydedildi ✓');
    Detail.open(record.AktiviteID);
  },

  teardown(){
    this.setStatus(null);
    this._wasBackgrounded = false;
    WakeLock.release();
    if(this.watchId!==null) navigator.geolocation.clearWatch(this.watchId);
    if(this.timerInt) clearInterval(this.timerInt);
    this.watchId=null; this.timerInt=null;
    if(this.marker){ this.map.removeLayer(this.marker); this.marker=null; }
    if(this.polyline){ this.polyline.setLatLngs([]); }
  }
};

/* ---------------- Dashboard ---------------- */
const Dashboard = {
  render(){
    Header.render();
    const active = Animals.active();
    const mine = sortActivitiesDesc(STATE.activities.filter(a=>a.HayvanID===active?.HayvanID));
    const today = mine.filter(a=>String(a.Tarih).slice(0,10)===todayISO());
    const todayKm = today.reduce((s,a)=>s+Number(a.MesafeKm||0),0);
    const todayMin = today.reduce((s,a)=>s+Number(a.SureDakika||0),0);
    document.getElementById('todayDistance').innerHTML = todayKm.toFixed(1)+' <span class="text-lg font-semibold text-inkmut">km</span>';
    document.getElementById('todayDuration').textContent = todayMin+' dk yürüyüş';

    const weekAgo = new Date(); weekAgo.setHours(0,0,0,0); weekAgo.setDate(weekAgo.getDate()-7);
    const week = mine.filter(a=>{ const d = parseLocalDate(a.Tarih); return d && d >= weekAgo; });
    document.getElementById('weekStats').textContent = week.reduce((s,a)=>s+Number(a.MesafeKm||0),0).toFixed(1)+' km';
    document.getElementById('totalWalks').textContent = mine.length;
    document.getElementById('liveWalks').textContent = mine.filter(a=>a.Tip==='Canli').length;

    const todayByWalker = {};
    today.forEach(a=>{ const name = walkerLabel(a.GezdirenKisi); todayByWalker[name] = (todayByWalker[name]||0) + 1; });
    const walkerEntries = Object.entries(todayByWalker);
    const twWrap = document.getElementById('todayWalkersWrap');
    twWrap.innerHTML = walkerEntries.length ? `
      <div class="card p-4">
        <p class="text-[11px] uppercase tracking-wider text-inkmut font-semibold mb-2.5">Bugün Kim Gezdirdi</p>
        <div class="flex flex-wrap gap-2">
          ${walkerEntries.map(([name,count])=>`
            <span class="flex items-center gap-1.5 bg-sun-soft text-sun-dark text-xs font-bold pl-2.5 pr-3 py-1.5 rounded-full">
              <span class="w-5 h-5 rounded-full bg-sun text-sun-dark flex items-center justify-center text-[10px]">${count}</span>
              ${name}
            </span>
          `).join('')}
        </div>
      </div>` : '';

    const list = document.getElementById('recentActivityList');
    const recent = mine.slice(0,5);
    list.innerHTML = recent.length ? recent.map(a=>ActivityUI.card(a)).join('') :
      `<div class="card p-6 text-center"><p class="text-sm text-inkmut">Henüz aktivite yok. "Başla" ile ilk yürüyüşünü ekle 🐾</p></div>`;
  }
};

/* ---------------- Activity card / detail ---------------- */
const ActivityUI = {
  card(a){
    const isLive = a.Tip==='Canli';
    return `
    <button onclick="Detail.open('${a.AktiviteID}')" class="w-full card p-4 flex items-center gap-3 text-left">
      <div class="w-11 h-11 rounded-full ${isLive?'bg-coral-soft':'bg-sky-soft'} flex items-center justify-center shrink-0">
        ${isLive ? `<svg viewBox="0 0 24 24" class="w-5 h-5 stroke-coral-dark" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>`
                 : `<svg viewBox="0 0 24 24" class="w-5 h-5 stroke-sky-dark" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>`}
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-display font-bold text-ink text-sm">${a.MesafeKm} km · ${a.SureDakika} dk</p>
        <p class="text-xs text-inkmut truncate">${a.Tarih} · ${walkerLabel(a.GezdirenKisi)} · ${isLive?'Canlı Takip':'Manuel'}</p>
      </div>
      <svg viewBox="0 0 24 24" class="w-4 h-4 stroke-inkmut shrink-0" fill="none" stroke-width="2.3" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }
};

const Detail = {
  map:null,
  open(id){
    const a = STATE.activities.find(x=>x.AktiviteID===id);
    if(!a) return;
    const animal = STATE.animals.find(x=>x.HayvanID===a.HayvanID);
    const isLive = a.Tip==='Canli';
    document.getElementById('detailContent').innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-display text-lg font-bold text-ink">${animal?.Avatar||'🐾'} ${animal?.Isim||''} · ${a.Tarih}</h3>
        <span class="text-[11px] font-bold px-2.5 py-1 rounded-full ${isLive?'bg-coral-soft text-coral-dark':'bg-sky-soft text-sky-dark'}">${isLive?'CANLI':'MANUEL'}</span>
      </div>
      ${isLive ? '<div id="detailMap" class="mini-map w-full h-52 rounded-card mb-4"></div>' : ''}
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="bg-base rounded-2xl p-3"><p class="text-[11px] text-inkmut font-semibold uppercase">Mesafe</p><p class="font-display font-bold text-ink tabular">${a.MesafeKm} km</p></div>
        <div class="bg-base rounded-2xl p-3"><p class="text-[11px] text-inkmut font-semibold uppercase">Süre</p><p class="font-display font-bold text-ink tabular">${a.SureDakika} dk</p></div>
        <div class="bg-base rounded-2xl p-3"><p class="text-[11px] text-inkmut font-semibold uppercase">Gezdiren</p><p class="font-display font-bold text-ink">${walkerLabel(a.GezdirenKisi)}</p></div>
        <div class="bg-base rounded-2xl p-3"><p class="text-[11px] text-inkmut font-semibold uppercase">Tip</p><p class="font-display font-bold text-ink">${isLive?'Canlı Takip':'Manuel'}</p></div>
      </div>
      ${a.Notlar ? `<div class="mb-4"><p class="text-[11px] text-inkmut font-semibold uppercase mb-1">Notlar</p><p class="text-sm text-ink">${a.Notlar}</p></div>` : ''}
      <button onclick="Detail.remove('${a.AktiviteID}')" class="w-full text-coral font-semibold text-sm py-2">Bu kaydı sil</button>
    `;
    Sheets.open('detailSheet');
    if(isLive){
      setTimeout(()=>{
        const coords = JSON.parse(a.RotaKoordinatlari || '[]');
        const m = L.map('detailMap', {zoomControl:false, dragging:true, scrollWheelZoom:false});
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19}).addTo(m);
        if(coords.length){
          const line = L.polyline(coords, {color:'#F14C6B', weight:5, lineCap:'round'}).addTo(m);
          m.fitBounds(line.getBounds(), {padding:[20,20]});
        } else { m.setView([41.3874,2.1686], 13); }
      }, 80);
    }
  },
  async remove(id){
    if(!confirm('Bu kaydı silmek istediğine emin misin?')) return;
    STATE.activities = STATE.activities.filter(a=>a.AktiviteID!==id);
    Store.set(LS.ACTIVITIES, STATE.activities);
    await Api.send('deleteActivity', {AktiviteID:id});
    Sheets.close('detailSheet');
    Toast.show('Kayıt silindi');
    Dashboard.render();
    if(Nav.current==='analytics') Analytics.render();
  }
};

/* ---------------- Analytics ---------------- */
const Analytics = {
  anchorDate: new Date(),
  monthsTR: ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'],

  setRange(r){
    STATE.range = r;
    this.anchorDate = new Date();
    document.querySelectorAll('.range-btn').forEach(b=>{
      const on = b.dataset.range===r;
      b.classList.toggle('bg-violet', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('text-inkmut', !on);
    });
    this.render();
  },

  periodBounds(){
    const anchor = new Date(this.anchorDate); anchor.setHours(0,0,0,0);
    if(STATE.range==='day'){
      return { from: anchor, to: anchor };
    }
    if(STATE.range==='week'){
      const dow = anchor.getDay(); // 0=Paz ... 6=Cmt
      const mondayOffset = (dow===0) ? -6 : (1-dow);
      const start = new Date(anchor); start.setDate(anchor.getDate()+mondayOffset);
      const end = new Date(start); end.setDate(start.getDate()+6);
      return { from: start, to: end };
    }
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth()+1, 0);
    return { from: start, to: end };
  },

  periodLabel(){
    const {from,to} = this.periodBounds();
    const fmt = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    if(STATE.range==='day'){
      const y = new Date(); y.setDate(y.getDate()-1);
      if(fmt(from)===todayISO()) return 'Bugün';
      if(fmt(from)===fmt(y)) return 'Dün';
      return from.getDate()+' '+this.monthsTR[from.getMonth()]+' '+from.getFullYear();
    }
    if(STATE.range==='week'){
      const sameMonth = from.getMonth()===to.getMonth();
      const left = from.getDate()+(sameMonth?'':' '+this.monthsTR[from.getMonth()]);
      const right = to.getDate()+' '+this.monthsTR[to.getMonth()]+' '+to.getFullYear();
      return left+' – '+right;
    }
    return this.monthsTR[from.getMonth()]+' '+from.getFullYear();
  },

  prevPeriod(){
    const a = new Date(this.anchorDate);
    if(STATE.range==='day') a.setDate(a.getDate()-1);
    else if(STATE.range==='week') a.setDate(a.getDate()-7);
    else a.setMonth(a.getMonth()-1);
    this.anchorDate = a;
    this.render();
  },
  nextPeriod(){
    const a = new Date(this.anchorDate);
    if(STATE.range==='day') a.setDate(a.getDate()+1);
    else if(STATE.range==='week') a.setDate(a.getDate()+7);
    else a.setMonth(a.getMonth()+1);
    this.anchorDate = a;
    this.render();
  },

  filtered(){
    const active = Animals.active();
    let mine = sortActivitiesDesc(STATE.activities.filter(a=>a.HayvanID===active?.HayvanID));
    const {from, to} = this.periodBounds();
    return mine.filter(a=>{ const d = parseLocalDate(a.Tarih); return d && d >= from && d <= to; });
  },

  render(){
    if(!document.querySelector('.range-btn.bg-violet')) { this.setRange(STATE.range); return; }

    document.getElementById('periodLabel').textContent = this.periodLabel();
    const today = new Date(); today.setHours(0,0,0,0);
    const {to} = this.periodBounds();
    const nextBtn = document.getElementById('nextPeriodBtn');
    nextBtn.classList.toggle('opacity-30', to >= today);
    nextBtn.classList.toggle('pointer-events-none', to >= today);

    const list = this.filtered();
    const km = list.reduce((s,a)=>s+Number(a.MesafeKm||0),0);
    const min = list.reduce((s,a)=>s+Number(a.SureDakika||0),0);
    document.getElementById('rangeDistance').textContent = km.toFixed(1)+' km';
    document.getElementById('rangeDuration').textContent = min+' dk';

    const byWalker = {};
    list.forEach(a=>{
      const name = walkerLabel(a.GezdirenKisi);
      byWalker[name] = byWalker[name] || {km:0,min:0,count:0};
      byWalker[name].km += Number(a.MesafeKm||0);
      byWalker[name].min += Number(a.SureDakika||0);
      byWalker[name].count += 1;
    });
    const maxKm = Math.max(1, ...Object.values(byWalker).map(v=>v.km));
    const colors = ['bg-violet','bg-coral','bg-sky','bg-sun'];
    const wrap = document.getElementById('walkerDistribution');
    const entries = Object.entries(byWalker);
    wrap.innerHTML = entries.length ? entries.map(([name,v],i)=>`
      <div>
        <div class="flex justify-between text-xs font-semibold text-ink mb-1"><span>${name}</span><span class="tabular text-inkmut">${v.count} yürüyüş · ${v.km.toFixed(1)} km · ${v.min} dk</span></div>
        <div class="h-2.5 bg-mist rounded-full overflow-hidden"><div class="h-full ${colors[i%colors.length]} rounded-full" style="width:${(v.km/maxKm*100).toFixed(0)}%"></div></div>
      </div>
    `).join('') : `<p class="text-sm text-inkmut text-center py-2">Bu aralıkta veri yok</p>`;

    const fullList = document.getElementById('fullActivityList');
    fullList.innerHTML = list.length ? list.map(a=>ActivityUI.card(a)).join('') :
      `<div class="card p-6 text-center"><p class="text-sm text-inkmut">Bu aralıkta aktivite bulunamadı</p></div>`;

    this.renderHeatmap(list);
  },

  heatMap:null, heatLayer:null,
  renderHeatmap(list){
    const points = [];
    list.filter(a=>a.Tip==='Canli' && a.RotaKoordinatlari).forEach(a=>{
      try{
        const coords = JSON.parse(a.RotaKoordinatlari);
        if(Array.isArray(coords)) coords.forEach(c=>{ if(Array.isArray(c) && c.length===2) points.push(c); });
      }catch(e){}
    });

    const container = document.getElementById('heatmapContainer');
    const empty = document.getElementById('heatmapEmpty');

    if(!points.length){
      container.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }
    container.classList.remove('hidden');
    empty.classList.add('hidden');

    setTimeout(()=>{
      if(!this.heatMap){
        this.heatMap = L.map('heatmapContainer', {zoomControl:false, attributionControl:false});
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, subdomains:'abc'}).addTo(this.heatMap);
      } else {
        this.heatMap.invalidateSize();
      }
      if(this.heatLayer) this.heatMap.removeLayer(this.heatLayer);
      this.heatLayer = L.heatLayer(points, {
        radius: 16, blur: 12, maxZoom: 17, minOpacity: 0.28, max: 0.8
        , gradient: {0.3:'#22C55E', 0.55:'#EAB308', 0.75:'#F97316', 1:'#EF4444'}
      }).addTo(this.heatMap);
      try{ this.heatLayer._canvas.style.opacity = '0.72'; }catch(e){}
      try{
        this.heatMap.fitBounds(L.latLngBounds(points), {padding:[24,24]});
      }catch(e){}
    }, 60);
  }
};

/* ---------------- Weather (Open-Meteo — API key gerektirmez) ----------------
   GPS izni varsa anlık konum kullanılır, yoksa/başarısızsa varsayılan bir
   şehir koordinatına (İstanbul) düşülür. Sıcaklık/yağış/rüzgara göre basit
   bir "akıllı yürüyüş saati" önerisi üretilir. */
const Weather = {
  DEFAULT_COORDS: { lat: 41.3874, lon: 2.1686 }, // Barselona, İspanya

  init(){
    this.getCoords().then(coords => this.fetchAndRender(coords));
  },

  getCoords(){
    return new Promise((resolve)=>{
      if(!navigator.geolocation){ resolve(this.DEFAULT_COORDS); return; }
      const timer = setTimeout(()=> resolve(this.DEFAULT_COORDS), 5000);
      navigator.geolocation.getCurrentPosition(
        pos => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
        () => { clearTimeout(timer); resolve(this.DEFAULT_COORDS); },
        { enableHighAccuracy:false, timeout:4500, maximumAge:600000 }
      );
    });
  },

  async fetchAndRender(coords){
    try{
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,wind_speed_10m,weather_code&hourly=precipitation_probability&timezone=auto&forecast_days=1`;
      const res = await fetch(url);
      const data = await res.json();

      const temp = data.current?.temperature_2m;
      const wind = data.current?.wind_speed_10m;
      const weatherCode = data.current?.weather_code;

      let rainProb = null;
      if(data.hourly?.time && data.hourly?.precipitation_probability){
        const nowHour = (data.current?.time || '').slice(0,13); // "YYYY-MM-DDTHH"
        const idx = data.hourly.time.findIndex(t => t.slice(0,13) === nowHour);
        rainProb = idx >= 0 ? data.hourly.precipitation_probability[idx] : data.hourly.precipitation_probability[0];
      }

      this.render({ temp, wind, rainProb, weatherCode });
    }catch(e){
      console.warn('Hava durumu alınamadı', e);
      const el = document.getElementById('weatherSuggestion');
      if(el) el.textContent = 'Hava durumu şu an alınamadı, internet bağlantını kontrol et.';
    }
  },

  iconFor(code, rainProb){
    if(rainProb!=null && rainProb>=60) return '🌧️';
    if(code>=95) return '⛈️';
    if(code>=71 && code<=77) return '❄️';
    if(code>=61 && code<=67) return '🌧️';
    if(code>=51 && code<=57) return '🌦️';
    if(code===45||code===48) return '🌫️';
    if(code===0) return '☀️';
    if(code<=3) return '🌤️';
    return '⛅';
  },

  suggestionFor({temp, wind, rainProb}){
    if(rainProb!=null && rainProb>=60){
      return `Yağmur ihtimali %${rainProb} — yürüyüşü öğleden sonraya ya da yarın sabaha ertelemeyi düşün. ☔`;
    }
    if(temp!=null && temp>=28){
      return `Hava ${Math.round(temp)}°C — öğle saatlerinde asfalt patileri yakabilir. Yürüyüşü akşam 19:00 serinliğine bırakmanı öneririz.`;
    }
    if(temp!=null && temp<=0){
      return `Hava ${Math.round(temp)}°C, donma riski var — yürüyüşü kısa tut, tuzlanmış/buzlu zeminlerden kaçın.`;
    }
    if(wind!=null && wind>=35){
      return `Rüzgar ${Math.round(wind)} km/s ile kuvvetli — açık alanlarda dikkatli ol.`;
    }
    return `Hava yürüyüş için gayet uygun — hazırsan hemen çıkabilirsin 🐾`;
  },

  render(info){
    const tempEl = document.getElementById('weatherTemp');
    const rainEl = document.getElementById('weatherRain');
    const windEl = document.getElementById('weatherWind');
    const iconEl = document.getElementById('weatherIcon');
    const sugEl = document.getElementById('weatherSuggestion');
    if(!tempEl) return;

    tempEl.textContent = info.temp!=null ? Math.round(info.temp)+'°' : '--°';
    rainEl.textContent = 'Yağış: ' + (info.rainProb!=null ? info.rainProb+'%' : '-');
    windEl.textContent = 'Rüzgar: ' + (info.wind!=null ? Math.round(info.wind)+' km/s' : '-');
    iconEl.textContent = this.iconFor(info.weatherCode, info.rainProb);
    sugEl.textContent = this.suggestionFor(info);
  }
};

/* ---------------- Boot ---------------- */
async function boot(){
  await Api.fetchAll();
  await Queue.flush();
  Header.render();
  Animals.buildAvatarPicker(AVATARS[0]);
  document.getElementById('animalForm').addEventListener('reset', ()=>{
    setTimeout(()=>{ document.getElementById('deleteAnimalBtn').classList.add('hidden'); Animals.buildAvatarPicker(AVATARS[0]); },0);
  });
  Nav.go(STATE.animals.length ? 'dashboard' : 'empty');
  Weather.init();
  setTimeout(()=>{ document.getElementById('splash').style.opacity='0'; document.getElementById('splash').style.pointerEvents='none'; setTimeout(()=>document.getElementById('splash').remove(),400); }, 550);
}

// "+" butonuna basınca formu temiz aç (edit değil, yeni ekleme akışı için)
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('button');
  if(btn && btn.getAttribute('onclick')?.includes("open('animalFormSheet')") && !btn.closest('#animalForm')){
    Animals.openAddForm();
  }
});

boot();
