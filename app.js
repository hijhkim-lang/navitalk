// ===== APP STATE =====
let appData = { dialogues: {}, keywords: {}, vocabulary: {} };
let currentLang = 'en';
let currentPlace = null;
let currentPlaceKey = null;
let userSearchInput = '';
let allScenarioData = [];
let selectedMap = 'naver';

// ===== LANGUAGE CONFIG =====
// Note: All dialogues_xx.json files store translations in 'english' field
// (because CSV→JSON conversion always maps last column to 'english')
const langConfig = {
  'en': { transKey: 'english', name: 'English',    searchPlaceholder: 'Enter a destination' },
  'cn': { transKey: 'english', name: '中文',       searchPlaceholder: '输入目的地' },
  'ja': { transKey: 'english', name: '日本語',     searchPlaceholder: '目的地を入力' },
  'es': { transKey: 'english', name: 'Español',     searchPlaceholder: 'Ingrese un destino' },
  'pt': { transKey: 'english', name: 'Português', searchPlaceholder: 'Digite um destino' },
  'fr': { transKey: 'english', name: 'Français',     searchPlaceholder: 'Entrez une destination' },
  'id': { transKey: 'english', name: 'Indonesia', searchPlaceholder: 'Masukkan tujuan' },
  'ms': { transKey: 'english', name: 'Melayu',        searchPlaceholder: 'Masukkan destinasi' },
  'th': { transKey: 'english', name: 'ภาษาไทย',         searchPlaceholder: 'ป้อนจุดหมายปลายทาง' },
  'vi': { transKey: 'english', name: 'Tiếng Việt', searchPlaceholder: 'Nhập điểm đến' },
  'de': { transKey: 'english', name: 'Deutsch',      searchPlaceholder: 'Reiseziel eingeben' }
};

// ===== DATA LOADING =====
async function loadCommonData() {
  try {
    const [kRes, vRes] = await Promise.all([
      fetch('keywords.json'),
      fetch('vocabulary.json')
    ]);
    appData.keywords = await kRes.json();
    appData.vocabulary = await vRes.json();
    console.log('Common data loaded: keywords + vocabulary');
  } catch(e) {
    console.error('Common data loading failed:', e);
  }
}

async function loadDialogues(lang) {
  const fileName = lang === 'en' ? 'dialogues_en.json' : `dialogues_${lang}.json`;
  try {
    const res = await fetch(fileName);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    appData.dialogues = await res.json();
    console.log(`Dialogues loaded [${lang}]:`, Object.keys(appData.dialogues).length, 'places');
    return true;
  } catch(e) {
    console.error(`Failed to load ${fileName}:`, e);
    // Fallback 1: if dialogues_en.json fails, try dialogues.json (old name)
    if (lang === 'en') {
      try {
        console.log('Trying fallback: dialogues.json');
        const fallback = await fetch('dialogues.json');
        if (!fallback.ok) throw new Error(`HTTP ${fallback.status}`);
        appData.dialogues = await fallback.json();
        console.log('Fallback dialogues.json loaded');
        return true;
      } catch(e2) {
        console.error('Fallback dialogues.json also failed:', e2);
      }
    }
    // Fallback 2: try English if other language fails
    if (lang !== 'en') {
      console.log('Falling back to English dialogues...');
      return await loadDialogues('en');
    }
    return false;
  }
}

// ===== PAGE NAVIGATION =====
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goBack() {
  window.speechSynthesis.cancel();
  document.getElementById('searchInput').value = '';
  document.getElementById('suggestions').innerHTML = '';
  showPage('page-map');
}

function goHome() {
  // 0. TTS 음성 즉시 정지
  window.speechSynthesis.cancel();
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
async function selectLanguage(lang) {
  currentLang = lang;
  
  // Show loading overlay
  const overlay = document.getElementById('loadingOverlay');
  const cfg = langConfig[lang] || langConfig['en'];
  overlay.querySelector('p').textContent = `Loading ${cfg.name}...`;
  overlay.classList.add('show');
  
  // Highlight selected button
  document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.remove('active-lang'));
  const clickedBtn = document.querySelector(`.lang-btn[onclick="selectLanguage('${lang}')"]`);
  if (clickedBtn) clickedBtn.classList.add('active-lang');
  
  // Load dialogues for selected language
  const success = await loadDialogues(lang);
  overlay.classList.remove('show');
  
  if (success) {
    // Update UI text for selected language
    updateUILanguage(lang);
    showPage('page-map');
    document.getElementById('searchInput').focus();
  } else {
    alert('Failed to load data. Please try again.');
  }
}

function updateUILanguage(lang) {
  const cfg = langConfig[lang] || langConfig['en'];
  // Update search placeholder
  document.getElementById('searchInput').placeholder = cfg.searchPlaceholder;
  // Reset search state
  document.getElementById('searchInput').value = '';
  document.getElementById('suggestions').innerHTML = '';
  currentPlace = null;
  currentPlaceKey = null;
  userSearchInput = '';
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

  // Search through keywords (English + Korean + current language)
  const results = [];
  for (const [placeType, kw] of Object.entries(appData.keywords)) {
    const enKeywords = kw.en || [];
    const koKeywords = kw.ko || [];
    const langKeywords = kw[currentLang] || [];
    let score = 0;
    for (const k of koKeywords) {
      if (k === query || k === this.value.trim()) { score = Math.max(score, 100); }
      else if (this.value.trim().includes(k) || k.includes(this.value.trim())) { score = Math.max(score, 50 + Math.min(k.length, this.value.trim().length)); }
      else if (k.includes(query) || query.includes(k)) { score = Math.max(score, 30 + Math.min(k.length, query.length)); }
    }
    for (const k of enKeywords) {
      if (k.toLowerCase() === query) { score = Math.max(score, 100); }
      else if (k.toLowerCase().includes(query) || query.includes(k.toLowerCase())) { score = Math.max(score, 30 + Math.min(k.length, query.length)); }
    }
    // Current language keywords (cn, ja, fr, etc.)
    for (const k of langKeywords) {
      const kLow = (typeof k === 'string') ? k.toLowerCase() : '';
      if (kLow === query || k === this.value.trim()) { score = Math.max(score, 100); }
      else if (this.value.trim().includes(k) || k.includes(this.value.trim())) { score = Math.max(score, 50 + Math.min(k.length, this.value.trim().length)); }
      else if (kLow.includes(query) || query.includes(kLow)) { score = Math.max(score, 30 + Math.min(k.length, query.length)); }
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
  // Don't auto-navigate — wait for user to click a map button
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
    const enKeywords = kw.en || [];
    const koKeywords = kw.ko || [];
    
    let score = 0;
    // Korean keyword matching with scoring
    for (const k of koKeywords) {
      if (k === dest) { score = Math.max(score, 100); }  // exact match
      else if (dest.includes(k)) { score = Math.max(score, 50 + k.length); }  // input contains keyword
      else if (k.includes(dest)) { score = Math.max(score, 30 + dest.length); }  // keyword contains input
    }
    // English keyword matching
    for (const k of enKeywords) {
      if (k.toLowerCase() === query) { score = Math.max(score, 100); }
      else if (query.includes(k.toLowerCase())) { score = Math.max(score, 50 + k.length); }
      else if (k.toLowerCase().includes(query)) { score = Math.max(score, 30 + query.length); }
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
  const mapUrl = type === 'naver' 
    ? 'https://map.naver.com/v5/search/' + encodeURIComponent(dest)
    : 'https://map.kakao.com/?q=' + encodeURIComponent(dest);
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
    en:'Improve Voice Quality', cn:'提高语音质量', ja:'音声品質を改善する',
    es:'Mejorar calidad de voz', fr:'Améliorer la qualité vocale',
    de:'Sprachqualität verbessern', pt:'Melhorar qualidade de voz',
    id:'Tingkatkan Kualitas Suara', ms:'Tingkatkan Kualiti Suara',
    th:'ปรับปรุงคุณภาพเสียง', vi:'Cải thiện chất lượng giọng nói'
  };
  html += `<div style="text-align:center;margin:16px 0 8px;"><a href="tts-guide.html?lang=${currentLang}" target="_blank" style="font-size:12px;color:#888;text-decoration:none;">🔊 ${guideText[currentLang]||guideText.en}</a></div>`;

  document.getElementById('scenarioList').innerHTML = html;
  
  showPage('page-scenario');
  
  // Update Navigate button to show selected map
  const navBtn = document.getElementById('navBtn');
  if (navBtn) {
    const mapName = selectedMap === 'kakao' ? 'Kakao Map' : 'Naver Map';
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
  const transKey = (langConfig[currentLang] || langConfig['en']).transKey;
  return lines.sort((a,b) => a.order - b.order).map((line, idx) => {
    const isA = isVisitorSpeaker(line.speaker);
    const cls = isA ? 'dial-a' : 'dial-b';
    const spkCls = isA ? 'spk-a' : 'spk-b';
    const label = isA ? 'A' : 'B';
    const labelKo = speakerKo(line.speaker);
    const ttsText = (line.tts || line.korean).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    // Get translation: try language-specific key, then english, then empty
    const translation = line[transKey] || line.english || '';
    
    return `
      <div class="dial-line ${cls}">
        <span class="dial-speaker ${spkCls}">${labelKo}</span>
        <button class="play-btn" data-tts="${ttsText}" data-spk="${label}">▶️</button>
        <div class="dial-korean">${line.korean}</div>
        <div class="dial-roman">${line.roman || ''}</div>
        <div class="dial-english">${translation}</div>
      </div>
    `;
  }).join('');
}

function toggleDialogue(idx) {
  const box = document.getElementById('dial-' + idx);
  if (box.classList.contains('open')) {
    box.classList.remove('open');
    window.speechSynthesis.cancel();
  } else {
    // Close all others
    document.querySelectorAll('.dialogue-box').forEach(b => b.classList.remove('open'));
    window.speechSynthesis.cancel();
    box.classList.add('open');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function closeDialogue(idx) {
  document.getElementById('dial-' + idx).classList.remove('open');
  window.speechSynthesis.cancel();
}

// ===== TTS =====
let voiceA = null; // Speaker A: bright, young female
let voiceB = null; // Speaker B: male

function loadKoreanVoices() {
  const voices = window.speechSynthesis.getVoices();
  const koVoices = voices.filter(v => v.lang.startsWith('ko'));
  
  // A: prefer female voices
  const femaleNames = ['Yuna', 'SunHi', 'Microsoft SunHi', 'Heami', 'Microsoft Heami', 'Google 한국의'];
  // B: prefer male voices
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
  
  if (female && male) {
    voiceA = female;
    voiceB = male;
  } else if (koVoices.length >= 2) {
    voiceA = koVoices[0];
    voiceB = koVoices[1];
  } else if (koVoices.length === 1) {
    voiceA = koVoices[0];
    voiceB = koVoices[0];
  }
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadKoreanVoices;
  loadKoreanVoices();
}

function speak(text, speaker) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    
    if (speaker === 'B') {
      // B: 젊고 상냥한 남자 - 낮은 톤
      utterance.rate = 1.5;
      utterance.pitch = 0.8;
      if (voiceB) utterance.voice = voiceB;
    } else {
      // A: 젊고 쾌활한 여자 - 밝은 톤
      utterance.rate = 1.5;
      utterance.pitch = 1.5;
      if (voiceA) utterance.voice = voiceA;
    }
    
    window.speechSynthesis.speak(utterance);
  } else {
    alert('TTS is not supported in this browser.');
  }
}

function listenAll(idx) {
  if (!allScenarioData[idx]) return;
  const lines = allScenarioData[idx].lines;
  if (!lines) return;
  
  window.speechSynthesis.cancel();
  const sorted = lines.sort((a,b) => a.order - b.order);
  let i = 0;
  
  function playNext() {
    if (i >= sorted.length) return;
    const line = sorted[i];
    const text = line.tts || line.korean;
    const isA = isVisitorSpeaker(line.speaker);
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    if (isA) {
      utterance.rate = 1.5; utterance.pitch = 1.5;
      if (voiceA) utterance.voice = voiceA;
    } else {
      utterance.rate = 1.5; utterance.pitch = 0.8;
      if (voiceB) utterance.voice = voiceB;
    }
    utterance.onend = () => { i++; playNext(); };
    window.speechSynthesis.speak(utterance);
  }
  playNext();
}

// ===== WORDS =====
function showWords() {
  if (!currentPlaceKey) return;
  const words = appData.vocabulary[currentPlaceKey] || [];
  const list = document.getElementById('wordsList');
  
  if (words.length === 0) {
    list.innerHTML = '<p style="color:#888; font-size:13px;">No vocabulary for this place.</p>';
  } else {
    list.innerHTML = words.map(w => {
      // vocabulary.json uses language codes directly: w.en, w.cn, w.ja, etc.
      const translation = w[currentLang] || w.en || '';
      return `
        <div class="word-item">
          <span class="word-kr">${w.korean}</span>
          <span class="word-en">${translation}</span>
        </div>
      `;
    }).join('');
  }
  
  document.getElementById('wordsModal').classList.add('show');
}

function closeWords() {
  window.speechSynthesis.cancel();
  document.getElementById('wordsModal').classList.remove('show');
}

function playWordsAudio() {
  const words = appData.vocabulary[currentPlaceKey] || [];
  if (words.length === 0) return;
  
  let i = 0;
  function playNext() {
    if (i >= words.length) return;
    const utterance = new SpeechSynthesisUtterance(words[i].korean);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.5;
    utterance.pitch = 1.5;
    if (voiceA) utterance.voice = voiceA;
    utterance.onend = () => { i++; setTimeout(playNext, 400); };
    window.speechSynthesis.speak(utterance);
  }
  window.speechSynthesis.cancel();
  playNext();
}

// ===== PLAY ALL SCENARIOS =====
function playAllScenarios() {
  if (!allScenarioData.length) return;
  const allItems = [];
  for (const sd of allScenarioData) {
    sd.lines.sort((a,b) => a.order - b.order).forEach(l => {
      const isA = isVisitorSpeaker(l.speaker);
      allItems.push({ text: l.tts || l.korean, isA });
    });
  }
  
  let i = 0;
  function playNext() {
    if (i >= allItems.length) return;
    const item = allItems[i];
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = 'ko-KR';
    if (item.isA) {
      u.rate = 1.5; u.pitch = 1.5;
      if (voiceA) u.voice = voiceA;
    } else {
      u.rate = 1.5; u.pitch = 0.8;
      if (voiceB) u.voice = voiceB;
    }
    u.onend = () => { i++; setTimeout(playNext, 500); };
    window.speechSynthesis.speak(u);
  }
  window.speechSynthesis.cancel();
  playNext();
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
  const url = selectedMap === 'kakao' 
    ? 'https://map.kakao.com/?q=' + encodeURIComponent(name)
    : 'https://map.naver.com/v5/search/' + encodeURIComponent(name);
  openExternal(url);
}

// ===== REQUEST SCENARIO =====
function requestScenario() {
  alert('This feature will be available soon!\nYou can request a new scenario for this location.');
}

// ===== INIT =====
loadCommonData();

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
