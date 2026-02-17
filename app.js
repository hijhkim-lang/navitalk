// ===== APP STATE =====
let appData = { dialogues: {}, keywords: {}, vocabulary: {} };
let currentLang = 'en';
let currentPlace = null;
let currentPlaceKey = null;
let userSearchInput = '';
let allScenarioData = [];
let selectedMap = 'naver';
let hasKoreanVoice = false;

// ===== TTS MANAGER =====
// Priority: Edge TTS (server-free) → Browser speechSynthesis → None
const ttsManager = {
  mode: 'checking',  // 'edge' | 'browser' | 'none' | 'checking'
  currentAudio: null,
  edgeChecked: false,
  edgeAvailable: false,
  browserAvailable: false,

  // Stop all audio playback
  stop() {
    // Stop Edge TTS audio
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        if (this.currentAudio._blobUrl) URL.revokeObjectURL(this.currentAudio._blobUrl);
      } catch(e) {}
      this.currentAudio = null;
    }
    // Stop browser TTS
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    // Cancel any queued sequence
    this._stopSequence = true;
  },

  // Check browser TTS availability
  checkBrowserVoice() {
    if (typeof speechSynthesis === 'undefined') return;
    var voices = speechSynthesis.getVoices();
    hasKoreanVoice = voices.some(function(v) { return v.lang.indexOf('ko') !== -1; });
    this.browserAvailable = hasKoreanVoice;
    if (!this.edgeAvailable && hasKoreanVoice) {
      this.mode = 'browser';
    }
  },

  // Initialize: test Edge TTS in background
  async init() {
    // Check browser TTS first (sync)
    this.checkBrowserVoice();

    // Test Edge TTS in background
    if (typeof EdgeTTS !== 'undefined') {
      try {
        this.edgeAvailable = await EdgeTTS.isAvailable();
      } catch(e) {
        this.edgeAvailable = false;
      }
    }
    this.edgeChecked = true;

    if (this.edgeAvailable) {
      this.mode = 'edge';
      console.log('TTS Mode: Edge TTS (cloud voices)');
    } else if (this.browserAvailable) {
      this.mode = 'browser';
      console.log('TTS Mode: Browser speechSynthesis');
    } else {
      this.mode = 'none';
      console.log('TTS Mode: None (no TTS available)');
    }
    return this.mode;
  },

  // Is any TTS available?
  isAvailable() {
    return this.mode === 'edge' || this.mode === 'browser';
  }
};

// Legacy browser voice check (for initial prompt)
function checkKoreanVoice() {
  ttsManager.checkBrowserVoice();
}
if (typeof speechSynthesis !== 'undefined') {
  checkKoreanVoice();
  speechSynthesis.onvoiceschanged = checkKoreanVoice;
}

// Start Edge TTS check in background
ttsManager.init();

// ===== DATA LOADING =====
async function loadData() {
  try {
    const [dRes, kRes, vRes] = await Promise.all([
      fetch('dialogues.json'),
      fetch('keywords.json'),
      fetch('vocabulary.json')
    ]);
    appData.dialogues = await dRes.json();
    appData.keywords = await kRes.json();
    appData.vocabulary = await vRes.json();
    console.log('Data loaded:', Object.keys(appData.dialogues).length, 'places');
  } catch(e) {
    console.error('Data loading failed:', e);
  }
}

// ===== PAGE NAVIGATION =====
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goBack() {
  ttsManager.stop();
  document.getElementById('searchInput').value = '';
  document.getElementById('suggestions').innerHTML = '';
  showPage('page-map');
}

function goHome() {
  // 0. TTS 음성 즉시 정지
  ttsManager.stop();
  // 1. Service Worker 캐시 삭제
  if ('caches' in window) {
    caches.keys().then(function(names) {
      for (let name of names) caches.delete(name);
    });
  }
  // 2. Service Worker 해제
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
      for (let reg of registrations) reg.unregister();
    });
  }
  // 3. 캐시 무시하고 새로 불러오기
  var url = window.location.href.split('?')[0];
  window.location.href = url + '?v=' + Date.now();
}

// ===== PAGE 1: Language Selection =====
const ttsPromptText = {
  en: { msg: "Korean voice is not installed on your device.\nTo hear Korean dialogues, please install a Korean voice pack.", install: "How to Install", skip: "Continue without voice" },
  ko: { msg: "한국어 음성이 설치되어 있지 않습니다.\n대화문을 듣기 위해 한국어 음성팩을 설치해주세요.", install: "설치 방법 보기", skip: "음성 없이 계속하기" },
  cn: { msg: "您的设备未安装韩语语音。\n请安装韩语语音包以收听对话。", install: "查看安装方法", skip: "跳过，继续使用" },
  ja: { msg: "韓国語の音声がインストールされていません。\n会話を聞くには韓国語音声をインストールしてください。", install: "インストール方法", skip: "音声なしで続ける" },
  es: { msg: "No hay voz coreana instalada.\nInstale el paquete de voz coreana para escuchar los diálogos.", install: "Cómo instalar", skip: "Continuar sin voz" },
  fr: { msg: "Aucune voix coréenne installée.\nInstallez le pack vocal coréen pour écouter les dialogues.", install: "Comment installer", skip: "Continuer sans voix" },
  pt: { msg: "Voz coreana não instalada.\nInstale o pacote de voz coreana para ouvir os diálogos.", install: "Como instalar", skip: "Continuar sem voz" },
  de: { msg: "Keine koreanische Stimme installiert.\nInstallieren Sie das koreanische Sprachpaket.", install: "Installationsanleitung", skip: "Ohne Stimme fortfahren" },
  id: { msg: "Suara Korea belum terpasang.\nPasang paket suara Korea untuk mendengar dialog.", install: "Cara memasang", skip: "Lanjutkan tanpa suara" },
  ms: { msg: "Suara Korea belum dipasang.\nSila pasang pakej suara Korea untuk mendengar dialog.", install: "Cara memasang", skip: "Teruskan tanpa suara" },
  th: { msg: "ยังไม่ได้ติดตั้งเสียงภาษาเกาหลี\nกรุณาติดตั้งเพื่อฟังบทสนทนา", install: "วิธีติดตั้ง", skip: "ดำเนินต่อโดยไม่มีเสียง" },
  vi: { msg: "Chưa cài giọng tiếng Hàn.\nHãy cài đặt để nghe hội thoại.", install: "Cách cài đặt", skip: "Tiếp tục không có giọng nói" }
};

// ===== MAP PAGE MULTILINGUAL TEXT & MAP CONFIG =====
const mapPageTexts = {
  en: { tagline: "Speak Korean at your next destination", sub: "Learn on the go while you travel", placeholder: "Enter a destination", mapLabel: "Select a map" },
  cn: { tagline: "在下一个目的地，用韩语交流", sub: "边走边学，让旅途更有趣", placeholder: "输入目的地", mapLabel: "选择地图" },
  ja: { tagline: "次の目的地で韓国語を話そう", sub: "旅しながら楽しく学ぼう", placeholder: "目的地を入力", mapLabel: "地図を選択" },
  es: { tagline: "Habla coreano en tu próximo destino", sub: "Aprende mientras viajas", placeholder: "Ingresa un destino", mapLabel: "Selecciona un mapa" },
  pt: { tagline: "Fale coreano no seu próximo destino", sub: "Aprenda enquanto viaja", placeholder: "Digite um destino", mapLabel: "Selecione um mapa" },
  fr: { tagline: "Parlez coréen à votre prochaine destination", sub: "Apprenez en voyageant", placeholder: "Entrez une destination", mapLabel: "Choisissez une carte" },
  de: { tagline: "Sprechen Sie Koreanisch am nächsten Reiseziel", sub: "Lernen Sie unterwegs", placeholder: "Reiseziel eingeben", mapLabel: "Karte auswählen" },
  id: { tagline: "Bicara Korea di tujuan berikutnya", sub: "Belajar sambil jalan-jalan", placeholder: "Masukkan tujuan", mapLabel: "Pilih peta" },
  ms: { tagline: "Cakap Korea di destinasi seterusnya", sub: "Belajar sambil melancong", placeholder: "Masukkan destinasi", mapLabel: "Pilih peta" },
  th: { tagline: "พูดภาษาเกาหลีที่จุดหมายถัดไป", sub: "เรียนรู้ระหว่างเดินทาง", placeholder: "ป้อนจุดหมายปลายทาง", mapLabel: "เลือกแผนที่" },
  vi: { tagline: "Nói tiếng Hàn tại điểm đến tiếp theo", sub: "Học trong khi du lịch", placeholder: "Nhập điểm đến", mapLabel: "Chọn bản đồ" }
};

const mapConfigs = {
  cn: [
    { id: 'naver', label: 'Naver Map(네이버)' },
    { id: 'gaode', label: '高德地图' }
  ],
  _default: [
    { id: 'naver', label: 'Naver Map' },
    { id: 'kakao', label: 'Kakao Map' },
    { id: 'google', label: 'Google Map' }
  ]
};

function updateMapPageTexts(lang) {
  var t = mapPageTexts[lang] || mapPageTexts.en;
  var tagline = document.querySelector('#page-map .tagline');
  var subTagline = document.querySelector('#page-map .sub-tagline');
  var searchInput = document.getElementById('searchInput');
  var mapLabel = document.getElementById('mapLabel');
  var mapBtnList = document.getElementById('mapBtnList');
  if (tagline) { tagline.textContent = t.tagline; tagline.className = 'tagline' + (lang === 'cn' ? ' tagline-cn' : ''); }
  if (subTagline) { subTagline.textContent = t.sub; subTagline.className = 'sub-tagline' + (lang === 'cn' ? ' sub-tagline-cn' : ''); }
  if (searchInput) searchInput.placeholder = t.placeholder;
  if (mapLabel) mapLabel.textContent = t.mapLabel;
  // Dynamic map buttons
  var maps = mapConfigs[lang] || mapConfigs._default;
  if (mapBtnList) {
    var html = '';
    for (var i = 0; i < maps.length; i++) {
      var m = maps[i];
      html += '<button class="map-btn" onclick="openMap(\'' + m.id + '\')">' + m.label + '</button>';
    }
    mapBtnList.innerHTML = html;
  }
}

function selectLanguage(lang) {
  currentLang = lang;
  updateMapPageTexts(lang);
  
  // Edge TTS 사용 가능하면 설치 안내 불필요 → 바로 진행
  if (ttsManager.mode === 'edge') {
    showPage('page-map');
    document.getElementById('searchInput').focus();
    return;
  }
  
  // 브라우저 한국어 음성 체크 (재확인)
  checkKoreanVoice();
  
  // 음성 있으면 바로 진행
  if (hasKoreanVoice) {
    showPage('page-map');
    document.getElementById('searchInput').focus();
    return;
  }
  
  // Edge TTS 아직 체크 중이면 잠시 대기 후 재확인
  if (ttsManager.mode === 'checking') {
    // Show brief loading then check again
    setTimeout(() => {
      if (ttsManager.mode === 'edge') {
        showPage('page-map');
        document.getElementById('searchInput').focus();
      } else {
        showTTSPrompt(lang);
      }
    }, 2000);
    return;
  }
  
  // 음성 없음 → 안내 팝업 표시
  showTTSPrompt(lang);
}

function showTTSPrompt(lang) {
  // 기존 팝업 있으면 제거
  var old = document.getElementById('ttsPrompt');
  if (old) old.remove();
  
  var t = ttsPromptText[lang] || ttsPromptText.en;
  
  var overlay = document.createElement('div');
  overlay.id = 'ttsPrompt';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  
  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;max-width:340px;width:100%;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
  
  box.innerHTML = '<div style="font-size:48px;margin-bottom:12px;">🔊</div>' +
    '<div style="font-size:14px;color:#333;line-height:1.7;white-space:pre-line;margin-bottom:20px;">' + t.msg + '</div>' +
    '<a href="tts-guide.html?lang=' + lang + '" target="_blank" style="display:block;padding:12px;background:#3498db;color:#fff;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;margin-bottom:10px;">' + t.install + '</a>' +
    '<button id="ttsSkipBtn" style="display:block;width:100%;padding:10px;background:none;border:1px solid #ccc;border-radius:10px;color:#888;font-size:13px;cursor:pointer;">' + t.skip + '</button>';
  
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  
  document.getElementById('ttsSkipBtn').addEventListener('click', function() {
    overlay.remove();
    showPage('page-map');
    document.getElementById('searchInput').focus();
  });
}

// ===== PAGE 2: Search & Map =====
document.getElementById('searchInput').addEventListener('input', function() {
  const query = this.value.trim().toLowerCase();
  const sugDiv = document.getElementById('suggestions');
  
  // Clear previous selection when user types new query
  currentPlace = null;
  currentPlaceKey = null;
  
  if (query.length < 1) {
    sugDiv.classList.remove('show');
    return;
  }

  // Search through keywords (all languages)
  const results = [];
  for (const [placeType, kw] of Object.entries(appData.keywords)) {
    let score = 0;
    // Search all language keywords
    for (const [lang, keywords] of Object.entries(kw)) {
      if (!Array.isArray(keywords)) continue;
      for (const k of keywords) {
        const kl = k.toLowerCase();
        if (kl === query || k === this.value.trim()) { score = Math.max(score, 100); }
        else if (this.value.trim().includes(k) || k.includes(this.value.trim())) { score = Math.max(score, 50 + Math.min(k.length, this.value.trim().length)); }
        else if (kl.includes(query) || query.includes(kl)) { score = Math.max(score, 30 + Math.min(k.length, query.length)); }
      }
    }
    if (score > 0 && appData.dialogues[placeType]) {
      const placeData = appData.dialogues[placeType];
      results.push({
        key: placeType,
        name_en: placeType.replace(/_/g,' '),
        name_kr: placeData.name_kr,
        score: score
      });
    }
  }

  // Also search by place name directly in dialogues
  for (const [key, val] of Object.entries(appData.dialogues)) {
    const nameMatch = key.toLowerCase().includes(query) || 
                      (val.name_kr && val.name_kr.includes(query));
    if (nameMatch && !results.find(r => r.key === key)) {
      let score = 0;
      if (val.name_kr === this.value.trim() || key.toLowerCase() === query) score = 100;
      else if (val.name_kr && this.value.trim().includes(val.name_kr)) score = 60 + val.name_kr.length;
      else score = 30;
      results.push({
        key: key,
        name_en: key.replace(/_/g,' '),
        name_kr: val.name_kr,
        score: score
      });
    }
  }

  // Sort by score (best match first)
  results.sort((a, b) => b.score - a.score);

  if (results.length > 0) {
    sugDiv.innerHTML = results.slice(0, 10).map(r => `
      <div class="suggestion-item" onclick="selectPlace('${r.key}')">
        <span class="place-name">${r.name_en}</span>
        <span class="place-kr">${r.name_kr}</span>
      </div>
    `).join('');
    sugDiv.classList.add('show');
  } else {
    sugDiv.classList.remove('show');
  }
});

function selectPlace(placeKey) {
  const inputEl = document.getElementById('searchInput');
  userSearchInput = inputEl.value.trim() || placeKey.replace(/_/g,' ');
  currentPlaceKey = placeKey;
  currentPlace = appData.dialogues[placeKey];
  document.getElementById('suggestions').classList.remove('show');
  inputEl.value = placeKey.replace(/_/g,' ');
  showScenarioPage();
}

function openMap(type) {
  selectedMap = type;
  const dest = document.getElementById('searchInput').value.trim();
  if (!dest) { alert('Please enter a destination first.'); return; }
  
  // If place already selected AND input matches current place, show scenarios
  if (currentPlace) {
    const curName = currentPlace.name_kr || currentPlaceKey.replace(/_/g,' ');
    const inputMatch = dest === curName || dest === currentPlaceKey.replace(/_/g,' ') || dest === userSearchInput;
    if (inputMatch) {
      showScenarioPage();
      return;
    }
    // Input changed - clear previous selection
    currentPlace = null;
    currentPlaceKey = null;
    userSearchInput = '';
  }
  
  // Find BEST matching place (score-based)
  const query = dest.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  
  for (const [placeType, kw] of Object.entries(appData.keywords)) {
    if (!appData.dialogues[placeType]) continue;
    
    let score = 0;
    // Search all language keywords
    for (const [lang, keywords] of Object.entries(kw)) {
      if (!Array.isArray(keywords)) continue;
      for (const k of keywords) {
        const kl = k.toLowerCase();
        if (k === dest || kl === query) { score = Math.max(score, 100); }
        else if (dest.includes(k) || query.includes(kl)) { score = Math.max(score, 50 + k.length); }
        else if (k.includes(dest) || kl.includes(query)) { score = Math.max(score, 30 + Math.min(dest.length, query.length)); }
      }
    }
    // Direct name match in dialogues
    const val = appData.dialogues[placeType];
    if (placeType.toLowerCase() === query || (val.name_kr && val.name_kr === dest)) { score = Math.max(score, 100); }
    else if (val.name_kr && dest.includes(val.name_kr)) { score = Math.max(score, 60 + val.name_kr.length); }
    else if (val.name_kr && val.name_kr.includes(dest)) { score = Math.max(score, 40 + dest.length); }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = placeType;
    }
  }
  
  // Also check direct dialogue name match
  for (const [key, val] of Object.entries(appData.dialogues)) {
    let score = 0;
    if (key.toLowerCase() === query) { score = 100; }
    else if (key.toLowerCase().includes(query)) { score = 40 + query.length; }
    if (val.name_kr && val.name_kr === dest) { score = Math.max(score, 100); }
    else if (val.name_kr && val.name_kr.includes(dest)) { score = Math.max(score, 40 + dest.length); }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = key;
    }
  }
  
  if (bestMatch) {
    selectPlace(bestMatch);
    return;
  }
  
  // No match found, just open map
  var mapUrl;
  if (type === 'naver') mapUrl = 'https://map.naver.com/v5/search/' + encodeURIComponent(dest);
  else if (type === 'kakao') mapUrl = 'https://map.kakao.com/?q=' + encodeURIComponent(dest);
  else if (type === 'google') mapUrl = 'https://www.google.com/maps/search/' + encodeURIComponent(dest);
  else if (type === 'gaode') mapUrl = 'https://www.amap.com/search?query=' + encodeURIComponent(dest);
  else mapUrl = 'https://map.naver.com/v5/search/' + encodeURIComponent(dest);
  openExternal(mapUrl);
}

// ===== CATEGORY SHARED SCENARIOS =====
const categoryMap = {
  // 핫플/카페거리
  'Ikseondong':'hotplace','Yongridan-gil':'hotplace','Gyeongnidan-gil':'hotplace',
  'Jeonpo Cafe Street':'hotplace','Euljiro':'hotplace','Mullae Art Village':'hotplace',
  'Sinsa-dong Garosu-gil':'hotplace','Yeontral Park':'hotplace','Seochon':'hotplace',
  'Seongsudong':'hotplace','Seongsudongcafe':'hotplace','hongdae':'hotplace',
  'gamcheon':'hotplace','Yeongdo Huinyeoul Culture':'hotplace',
  // 궁궐
  'Gyeongbokgung':'palace','Changdeokgung Palace':'palace','Deoksugung Palace':'palace',
  // 한옥마을
  'Bukchon Hanok':'hanok','Namsangol Hanok':'hanok',
  'Jeonju Hanok Village':'hanok','Andong Hahoe Village':'hanok',
  // 사찰
  'Gilsangsa Temple':'temple_lm','Yonggung Temple':'temple_lm',
  'Bulguksa Temple':'temple_lm','Seokguram Grotto':'temple_lm',
  'Haeinsa Temple':'temple_lm','Buseoksa Temple':'temple_lm','Beopjusa Temple':'temple_lm',
  // 전망/스카이워크
  'Seoultower':'viewpoint','Oryukdo Skywalk':'viewpoint','Yongdusan':'viewpoint',
  'Songdo Bay Cable':'viewpoint','Seokchon Lake':'viewpoint','Banpo':'viewpoint',
  // 국립공원/산
  'Seoraksan':'natpark','Jirisan':'natpark','Juwangsan':'natpark','Jusanji Pond':'natpark',
  'hallamountain':'natpark','Namhansanseong':'natpark','1100highland':'natpark',
  // 해변/해안
  'Yeongjin':'coastal','Guryongpo':'coastal','tapdong':'coastal','Jungmun':'coastal',
  'seongsanIlchulbong':'coastal',
  // 전통시장
  'dongmunmarket':'market_lm','dongdaemunmarket':'market_lm','Haenggung-dong':'market_lm',
  // 관광지/테마
  'Nami Island':'tour_lm','Petite France':'tour_lm',
  'The Garden of Morning Calm':'tour_lm','Children Grand Park':'tour_lm',
  'Dongdaemun Design Plaza':'tour_lm','Seodaemun Prison':'tour_lm',
  'Naksan Park':'tour_lm','Independence Hall':'tour_lm',
  'Suwon Hwaseong':'tour_lm','Hanbyeokdang':'tour_lm',
  'Seongeup Folk Village':'tour_lm','Stone Wall Path':'tour_lm',
  'yongduam':'tour_lm'
};

const categoryShared = {
  'hotplace':   { label:'카페/맛집 회화', shared:['cafe','koreanrestaurant'] },
  'palace':     { label:'전통문화 회화', shared:['traditional'] },
  'hanok':      { label:'전통문화 회화', shared:['traditional'] },
  'temple_lm':  { label:'사찰 회화', shared:['temple'] },
  'viewpoint':  { label:'공원/관람 회화', shared:['park'] },
  'natpark':    { label:'등산/자연 회화', shared:['mountain','park'] },
  'coastal':    { label:'해변/관광 회화', shared:['beach'] },
  'market_lm':  { label:'전통시장 회화', shared:['traditionalmarket'] },
  'tour_lm':    { label:'관광/입장 회화', shared:['museum','tourinfo'] }
};

function getSharedScenarios(placeKey) {
  const cat = categoryMap[placeKey];
  if (!cat || !categoryShared[cat]) return {};
  const shared = {};
  for (const sharedKey of categoryShared[cat].shared) {
    if (appData.dialogues[sharedKey] && appData.dialogues[sharedKey].scenarios) {
      const srcName = appData.dialogues[sharedKey].name_kr || sharedKey;
      for (const [sName, sLines] of Object.entries(appData.dialogues[sharedKey].scenarios)) {
        shared[`[${srcName}] ${sName}`] = sLines;
      }
    }
  }
  return shared;
}

// ===== PAGE 3: Scenario List =====
function showScenarioPage() {
  if (!currentPlace) return;
  
  const badge = document.getElementById('placeBadge');
  const genericName = currentPlace.name_kr || currentPlaceKey.replace(/_/g,' ');
  if (userSearchInput && userSearchInput !== genericName && userSearchInput !== currentPlaceKey.replace(/_/g,' ')) {
    badge.textContent = userSearchInput + ' → ' + genericName;
  } else {
    badge.textContent = genericName + ' (' + currentPlaceKey.replace(/_/g,' ') + ')';
  }
  
  const numSort = (a, b) => {
    const numA = parseFloat(a.match(/[\d.]+/)?.[0]) || 0;
    const numB = parseFloat(b.match(/[\d.]+/)?.[0]) || 0;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  };
  
  // Own scenarios
  const ownKeys = Object.keys(currentPlace.scenarios).sort(numSort);
  allScenarioData = [];
  
  let html = '';
  let idx = 0;
  
  // Render own scenarios
  ownKeys.forEach(s => {
    allScenarioData.push({ name: s, lines: currentPlace.scenarios[s] });
    html += `<div>
      <div class="scenario-row" onclick="toggleDialogue(${idx})">
        <span class="scenario-title">${s}</span>
      </div>
      <div class="dialogue-box" id="dial-${idx}">
        ${renderDialogue(currentPlace.scenarios[s])}
        <div class="dial-btn-row">
          <button class="listen-all-btn" onclick="listenAll(${idx})">▶ Listen All</button>
          <button class="close-dial-btn" onclick="closeDialogue(${idx})">close</button>
        </div>
      </div>
    </div>`;
    idx++;
  });
  
  // Shared category scenarios
  const shared = getSharedScenarios(currentPlaceKey);
  const sharedKeys = Object.keys(shared).sort(numSort);
  
  if (sharedKeys.length > 0) {
    const cat = categoryMap[currentPlaceKey];
    const catLabel = categoryShared[cat]?.label || '관련 회화';
    html += `<div class="shared-divider">${catLabel}</div>`;
    
    sharedKeys.forEach(s => {
      allScenarioData.push({ name: s, lines: shared[s] });
      html += `<div>
        <div class="scenario-row scenario-shared" onclick="toggleDialogue(${idx})">
          <span class="scenario-title">${s}</span>
        </div>
        <div class="dialogue-box" id="dial-${idx}">
          ${renderDialogue(shared[s])}
          <div class="dial-btn-row">
            <button class="listen-all-btn" onclick="listenAll(${idx})">▶ Listen All</button>
            <button class="close-dial-btn" onclick="closeDialogue(${idx})">close</button>
          </div>
        </div>
      </div>`;
      idx++;
    });
  }
  
  // TTS voice guide link
  const guideText = {
    en:'Improve Voice Quality', cn:'\u63D0\u9AD8\u8BED\u97F3\u8D28\u91CF', ja:'\u97F3\u58F0\u54C1\u8CEA\u3092\u6539\u5584\u3059\u308B',
    es:'Mejorar calidad de voz', fr:'Am\u00E9liorer la qualit\u00E9 vocale',
    de:'Sprachqualit\u00E4t verbessern', pt:'Melhorar qualidade de voz',
    id:'Tingkatkan Kualitas Suara', ms:'Tingkatkan Kualiti Suara',
    th:'\u0E1B\u0E23\u0E31\u0E1A\u0E1B\u0E23\u0E38\u0E07\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E40\u0E2A\u0E35\u0E22\u0E07', vi:'C\u1EA3i thi\u1EC7n ch\u1EA5t l\u01B0\u1EE3ng gi\u1ECDng n\u00F3i'
  };
  html += '<div style="text-align:center;margin:16px 0 8px;"><a href="tts-guide.html?lang=' + currentLang + '" target="_blank" style="font-size:12px;color:#888;text-decoration:none;">\uD83D\uDD0A ' + (guideText[currentLang]||guideText.en) + '</a></div>';

  document.getElementById('scenarioList').innerHTML = html;
  
  showPage('page-scenario');
  
  // Update Navigate button to show selected map
  const navBtn = document.getElementById('navBtn');
  if (navBtn) {
    const mapNames = {naver:'Naver Map', kakao:'Kakao Map', google:'Google Map', gaode:'高德地图'};
    const mapName = mapNames[selectedMap] || 'Naver Map';
    navBtn.textContent = 'Navigate (' + mapName + ')';
  }
}

// === Speaker Korean Name Map ===
const speakerKoMap = {
  'customer':'손님','staff':'직원','traveler':'여행자','guest':'투숙객',
  'patient':'환자','doctor':'의사','nurse':'간호사','dentist':'치과의사',
  'pharmacist':'약사','driver':'기사','passenger':'승객','officer':'경찰관',
  'vendor':'판매원','guide':'가이드','monk':'스님','teacher':'선생님',
  'student':'학생','librarian':'사서','bartender':'바텐더','caddie':'캐디',
  'caller':'전화자','hiker1':'등산객1','hiker2':'등산객2',
  'therapist':'치료사','vet':'수의사','parent':'보호자','guardian':'보호자',
  'fan':'팬','player':'선수','volunteer':'자원봉사자','korean':'한국인',
  'seoulite':'서울시민','citizen':'시민','citiizen':'시민',
  'passerby':'행인','buyer':'구매자','turist':'관광객','visitor':'방문객',
  'yimo':'이모'
};
function speakerKo(en) {
  if (!en) return '?';
  const key = en.toLowerCase().trim();
  return speakerKoMap[key] || en;
}

// === isA speaker check (visitor side) ===
function isVisitorSpeaker(spk) {
  const s = spk.toLowerCase();
  return s.includes('customer') || s.includes('traveler') || s.includes('guest') ||
         s.includes('patient') || s.includes('buyer') || s.includes('visitor') ||
         s.includes('passenger') || s.includes('caller') || s.includes('hiker') ||
         s.includes('turist') || s.includes('student') || s.includes('parent') ||
         s.includes('guardian') || s.includes('fan') || s.includes('player') ||
         s.includes('citizen') || s.includes('citiizen') || s.includes('korean') ||
         s.includes('seoulite');
}

function renderDialogue(lines) {
  return lines.sort((a,b) => a.order - b.order).map((line, idx) => {
    const isA = isVisitorSpeaker(line.speaker);
    const cls = isA ? 'dial-a' : 'dial-b';
    const spkCls = isA ? 'spk-a' : 'spk-b';
    const label = isA ? 'A' : 'B';
    const labelKo = speakerKo(line.speaker);
    const ttsText = (line.tts || line.korean).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    
    return `
      <div class="dial-line ${cls}">
        <span class="dial-speaker ${spkCls}">${labelKo}</span>
        <button class="play-btn" data-tts="${ttsText}" data-spk="${label}">▶️</button>
        <div class="dial-korean">${line.korean}</div>
        <div class="dial-roman">${line.roman || ''}</div>
        <div class="dial-english">${line.english || ''}</div>
      </div>
    `;
  }).join('');
}

function toggleDialogue(idx) {
  const box = document.getElementById('dial-' + idx);
  if (box.classList.contains('open')) {
    box.classList.remove('open');
    ttsManager.stop();
  } else {
    // Close all others
    document.querySelectorAll('.dialogue-box').forEach(b => b.classList.remove('open'));
    ttsManager.stop();
    box.classList.add('open');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function closeDialogue(idx) {
  document.getElementById('dial-' + idx).classList.remove('open');
  ttsManager.stop();
}

// ===== TTS =====
let voiceA = null; // Speaker A: bright, young female
let voiceB = null; // Speaker B: male

function loadKoreanVoices() {
  const voices = window.speechSynthesis.getVoices();
  const koVoices = voices.filter(v => v.lang.startsWith('ko'));
  
  const femaleNames = ['Yuna', 'SunHi', 'Microsoft SunHi', 'Heami', 'Microsoft Heami', 'Google 한국의'];
  const maleNames = ['InJoon', 'Microsoft InJoon', 'Hyunsu', 'Microsoft Hyunsu'];
  
  let female = null, male = null;
  for (const name of femaleNames) {
    const v = koVoices.find(v => v.name.includes(name));
    if (v) { female = v; break; }
  }
  for (const name of maleNames) {
    const v = koVoices.find(v => v.name.includes(name));
    if (v) { male = v; break; }
  }
  
  if (female && male) { voiceA = female; voiceB = male; }
  else if (koVoices.length >= 2) { voiceA = koVoices[0]; voiceB = koVoices[1]; }
  else if (koVoices.length === 1) { voiceA = koVoices[0]; voiceB = koVoices[0]; }
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { loadKoreanVoices(); ttsManager.checkBrowserVoice(); };
  loadKoreanVoices();
}

// --- Browser TTS speak (fallback) ---
function browserSpeak(text, speaker) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    if (speaker === 'B') {
      u.rate = 1.25; u.pitch = 0.85;
      if (voiceB) u.voice = voiceB;
    } else {
      u.rate = 1.25; u.pitch = 1.65;
      if (voiceA) u.voice = voiceA;
    }
    u.onend = () => resolve();
    u.onerror = () => resolve();
    requestAnimationFrame(() => window.speechSynthesis.speak(u));
  });
}

// --- Main speak: Edge TTS → Browser TTS → silent ---
function speak(text, speaker) {
  ttsManager.stop();

  if (ttsManager.mode === 'edge') {
    EdgeTTS.synthesize(text, speaker).then(blob => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio._blobUrl = url;
      ttsManager.currentAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(url); ttsManager.currentAudio = null; };
      audio.onerror = () => { URL.revokeObjectURL(url); ttsManager.currentAudio = null; browserSpeak(text, speaker); };
      audio.play().catch(() => browserSpeak(text, speaker));
    }).catch(() => browserSpeak(text, speaker));
  } else if (ttsManager.mode === 'browser') {
    browserSpeak(text, speaker);
  }
}

// --- Sequential playback (Edge TTS with prefetch + fallback) ---
async function speakSequence(items) {
  ttsManager._stopSequence = false;
  for (let i = 0; i < items.length; i++) {
    if (ttsManager._stopSequence) break;
    const { text, speaker } = items[i];

    if (ttsManager.mode === 'edge') {
      try {
        // Prefetch next item
        if (items[i + 1]) EdgeTTS.synthesize(items[i + 1].text, items[i + 1].speaker).catch(() => {});
        const blob = await EdgeTTS.synthesize(text, speaker);
        if (ttsManager._stopSequence) break;
        await new Promise((resolve) => {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio._blobUrl = url;
          ttsManager.currentAudio = audio;
          audio.onended = () => { URL.revokeObjectURL(url); ttsManager.currentAudio = null; resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); ttsManager.currentAudio = null; resolve(); };
          audio.play().catch(() => resolve());
        });
        if (i < items.length - 1 && !ttsManager._stopSequence) await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        if (!ttsManager._stopSequence) await browserSpeak(text, speaker);
      }
    } else if (ttsManager.mode === 'browser') {
      await browserSpeak(text, speaker);
      if (i < items.length - 1 && !ttsManager._stopSequence) await new Promise(r => setTimeout(r, 300));
    }
  }
}

function listenAll(idx) {
  if (!allScenarioData[idx]) return;
  const lines = allScenarioData[idx].lines;
  if (!lines) return;
  ttsManager.stop();
  const sorted = [...lines].sort((a,b) => a.order - b.order);
  speakSequence(sorted.map(l => ({ text: l.tts || l.korean, speaker: isVisitorSpeaker(l.speaker) ? 'A' : 'B' })));
}

// ===== WORDS =====
function showWords() {
  if (!currentPlaceKey) return;
  const words = appData.vocabulary[currentPlaceKey] || [];
  const list = document.getElementById('wordsList');
  
  if (words.length === 0) {
    list.innerHTML = '<p style="color:#888; font-size:13px;">No vocabulary for this place.</p>';
  } else {
    list.innerHTML = words.map(w => `
      <div class="word-item">
        <span class="word-kr">${w.korean}</span>
        <span class="word-en">${w.english}</span>
      </div>
    `).join('');
  }
  
  document.getElementById('wordsModal').classList.add('show');
}

function closeWords() {
  ttsManager.stop();
  document.getElementById('wordsModal').classList.remove('show');
}

function playWordsAudio() {
  const words = appData.vocabulary[currentPlaceKey] || [];
  if (words.length === 0) return;
  ttsManager.stop();
  speakSequence(words.map(w => ({ text: w.korean, speaker: 'A' })));
}

// ===== PLAY ALL SCENARIOS =====
function playAllScenarios() {
  if (!allScenarioData.length) return;
  const items = [];
  for (const sd of allScenarioData) {
    [...sd.lines].sort((a,b) => a.order - b.order).forEach(l => {
      items.push({ text: l.tts || l.korean, speaker: isVisitorSpeaker(l.speaker) ? 'A' : 'B' });
    });
  }
  ttsManager.stop();
  speakSequence(items);
}

// ===== OPEN EXTERNAL LINK (PWA-safe) =====
function openExternal(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== NAVIGATE =====
function navigateToDestination() {
  if (!currentPlaceKey) return;
  const name = userSearchInput || currentPlace.name_kr || currentPlaceKey;
  var url;
  if (selectedMap === 'kakao') url = 'https://map.kakao.com/?q=' + encodeURIComponent(name);
  else if (selectedMap === 'google') url = 'https://www.google.com/maps/search/' + encodeURIComponent(name);
  else if (selectedMap === 'gaode') url = 'https://www.amap.com/search?query=' + encodeURIComponent(name);
  else url = 'https://map.naver.com/v5/search/' + encodeURIComponent(name);
  openExternal(url);
}

// ===== REQUEST SCENARIO =====
function requestScenario() {
  alert('This feature will be available soon!\nYou can request a new scenario for this location.');
}

// ===== INIT =====
loadData();

// Event delegation for play buttons
document.addEventListener('click', function(e) {
  const playBtn = e.target.closest('.play-btn');
  if (playBtn) {
    e.stopPropagation();
    const tts = playBtn.getAttribute('data-tts');
    const spk = playBtn.getAttribute('data-spk') || 'A';
    if (tts) speak(tts, spk);
  }
});

// Close suggestions when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.search-box') && !e.target.closest('.suggestions')) {
    document.getElementById('suggestions').classList.remove('show');
  }
});
