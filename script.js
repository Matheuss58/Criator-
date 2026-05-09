// ======================================================
// 🎬 VIRAL PODCAST CLIPPER - UNIFIED VERSION
// Combina:
// ✅ Upload via File API Gemini
// ✅ Transcript com timestamps por palavra
// ✅ Legenda dinâmica (palavra ativa)
// ✅ Crop inteligente (1080x1920, cover)
// ✅ Fallback por atividade de áudio (RMS)
// ✅ Títulos e hashtags editáveis
// ✅ Export MP4 (WebM)
// ======================================================

// ------------------------------------------------------
// DOM elements
// ------------------------------------------------------
const geminiKeyInput = document.getElementById('geminiApiKey');
const saveApiBtn = document.getElementById('saveApiBtn');
const videoUpload = document.getElementById('videoUpload');
const fileDropZone = document.getElementById('fileDropZone');
const fileNameSpan = document.getElementById('fileName');
const previewContainer = document.getElementById('videoPreviewContainer');
const previewVideo = document.getElementById('previewVideo');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusDiv = document.getElementById('statusMsg');
const sourceVideo = document.getElementById('sourceVideo');
const renderCanvas = document.getElementById('renderCanvas');
const ctx = renderCanvas.getContext('2d');

// Canvas 1080x1920 (9:16)
renderCanvas.width = 1080;
renderCanvas.height = 1920;

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// ------------------------------------------------------
// State
// ------------------------------------------------------
let currentApiKey = '';
let uploadedVideoFile = null;
let uploadedFileUri = null;
let videoDuration = 0;
let viralClips = [];        // cada elemento: { start, end, title, descriptionWithHashtags, transcript }
let isRendering = false;

// ------------------------------------------------------
// Configurações de renderização
// ------------------------------------------------------
const RENDER_CONFIG = {
  FPS: 30,
  TITLE_FONT: 'bold 56px "Inter", system-ui, sans-serif',
  SUBTITLE_FONT: 'bold 48px "Inter", system-ui, sans-serif',
  BITRATE: 6000000,          // 6 Mbps
  COLORS: {
    titleBg: 'rgba(0,0,0,0.65)',
    titleText: '#ffffff',
    subtitleNormal: '#ffffff',
    subtitleActive: '#ffe066',
    shadow: '#000000'
  }
};

// ------------------------------------------------------
// API Key (sessionStorage)
// ------------------------------------------------------
function loadStoredKey() {
  const saved = sessionStorage.getItem('gemini_api_key');
  if (saved) {
    currentApiKey = saved;
    geminiKeyInput.value = saved;
    geminiKeyInput.disabled = true;
    saveApiBtn.textContent = '✔️ Chave ativa';
    saveApiBtn.disabled = true;
    return true;
  }
  return false;
}

saveApiBtn.addEventListener('click', () => {
  const key = geminiKeyInput.value.trim();
  if (!key) {
    statusDiv.textContent = '❌ Insira uma chave válida da API Gemini';
    return;
  }
  sessionStorage.setItem('gemini_api_key', key);
  currentApiKey = key;
  geminiKeyInput.disabled = true;
  saveApiBtn.textContent = '✔️ Salva';
  saveApiBtn.disabled = true;
  statusDiv.textContent = '🔑 Chave salva! Agora faça upload do vídeo.';
  checkReadyToAnalyze();
});

// ------------------------------------------------------
// Upload e preview do vídeo
// ------------------------------------------------------
fileDropZone.addEventListener('click', () => videoUpload.click());
videoUpload.addEventListener('change', handleVideoFile);
fileDropZone.addEventListener('dragover', (e) => { e.preventDefault(); fileDropZone.style.borderColor = '#c084fc'; });
fileDropZone.addEventListener('dragleave', () => fileDropZone.style.borderColor = '#4b4b6e');
fileDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDropZone.style.borderColor = '#4b4b6e';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) processVideoFile(file);
  else statusDiv.textContent = '⚠️ Arraste apenas arquivos de vídeo.';
});

function handleVideoFile(e) {
  const file = e.target.files[0];
  if (file) processVideoFile(file);
}

function processVideoFile(file) {
  const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
  if (file.size > maxSize) {
    statusDiv.textContent = '❌ Vídeo maior que 2GB. Reduza o tamanho.';
    return;
  }
  fileNameSpan.textContent = file.name;
  uploadedVideoFile = file;
  
  const url = URL.createObjectURL(file);
  previewVideo.src = url;
  previewContainer.style.display = 'block';
  previewVideo.load();
  
  previewVideo.onloadedmetadata = () => {
    videoDuration = previewVideo.duration;
    statusDiv.textContent = `✅ Vídeo carregado (${videoDuration.toFixed(1)} segundos, ${(file.size / (1024*1024)).toFixed(1)} MB). Pronto para enviar à IA.`;
    checkReadyToAnalyze();
  };
}

function checkReadyToAnalyze() {
  if (currentApiKey && uploadedVideoFile && videoDuration > 0) {
    analyzeBtn.disabled = false;
    statusDiv.textContent = '🎯 Clique em "Gerar 10 clipes virais com IA" – o upload pode demorar alguns segundos.';
  } else {
    analyzeBtn.disabled = true;
  }
}

// ------------------------------------------------------
// File API Gemini (upload e espera ativa)
// ------------------------------------------------------
async function uploadToGeminiFileAPI(file, apiKey) {
  const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Protocol': 'multipart' },
    body: formData
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Upload falhou: ${response.status} - ${err}`);
  }
  
  const data = await response.json();
  if (!data.file || !data.file.uri) throw new Error('Resposta da API não contém URI do arquivo');
  return data.file.uri;
}

async function waitForFileActive(fileUri, apiKey, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileUri}?key=${apiKey}`);
    const data = await res.json();
    if (data.state === 'ACTIVE') return true;
    if (data.state === 'FAILED') throw new Error('Arquivo falhou no processamento');
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Timeout aguardando o arquivo ficar ativo');
}

// ------------------------------------------------------
// Análise com Gemini (pedindo transcript com timestamps)
// ------------------------------------------------------
async function analyzeVideoWithGemini() {
  if (!currentApiKey || !uploadedVideoFile) throw new Error('Chave ou vídeo faltando');
  statusDiv.textContent = '📤 Enviando vídeo para a API Gemini (até 2GB)...';
  analyzeBtn.disabled = true;
  
  try {
    const fileUri = await uploadToGeminiFileAPI(uploadedVideoFile, currentApiKey);
    uploadedFileUri = fileUri;
    statusDiv.textContent = '⏳ Aguardando processamento do vídeo pela Google...';
    await waitForFileActive(fileUri, currentApiKey);
    
    const prompt = `
Você é um especialista em cortes virais para TikTok/Reels/Shorts.
Analise este vídeo de podcast e identifique os 10 trechos com MAIOR POTENCIAL de viralização.

REGRAS IMPORTANTES:
- Cada trecho deve ter entre 12 e 30 segundos de duração.
- **NÃO** escolha trechos que começam nos primeiros 15 segundos do vídeo.
- Priorize momentos de virada, emoção intensa, humor inesperado, polêmica ou revelação impactante.
- Evite trechos monótonos ou sem variação de ritmo.

Para cada um dos 10 trechos, retorne um objeto no seguinte formato:

{
  "startTime": 25.5,
  "endTime": 45.0,
  "title": "Título curioso e chamativo (máx 8 palavras)",
  "descriptionWithHashtags": "Frase de impacto #hashtag1 #hashtag2 #hashtag3 #podcast #viral",
  "transcript": [
    { "word": "Olá", "start": 25.5, "end": 25.8 },
    { "word": "pessoal", "start": 25.9, "end": 26.3 }
  ]
}

INSTRUÇÕES IMPORTANTES:
- O campo "transcript" deve conter a fala exata do trecho, com timestamps absolutos (dentro do vídeo completo).
- Cada palavra deve ter seu tempo de início e fim (precisão de décimos de segundo).
- Se o trecho tem silêncios, apenas inclua as palavras faladas.
- O texto do transcript deve ser o mais fiel possível ao áudio.
- A duração total do vídeo é ${videoDuration.toFixed(1)} segundos.

Retorne APENAS um JSON válido com a chave "clips" contendo um array de 10 objetos.
`;
    
    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${currentApiKey}`;
    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          { file_data: { mime_type: uploadedVideoFile.type, file_uri: uploadedFileUri } }
        ]
      }]
    };
    
    const response = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erro ao gerar conteúdo: ${response.status} - ${errText}`);
    }
    
    const data = await response.json();
    const rawText = data.candidates[0].content.parts[0].text;
    
    // Extrair JSON
    let jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
    let jsonStr = jsonMatch ? jsonMatch[1] : rawText;
    if (!jsonStr.trim().startsWith('{')) {
      const braceMatch = jsonStr.match(/({[\s\S]*})/);
      if (braceMatch) jsonStr = braceMatch[1];
    }
    const parsed = JSON.parse(jsonStr);
    let clipsArray = parsed.clips || (Array.isArray(parsed) ? parsed : []);
    if (!clipsArray.length) throw new Error('IA não retornou clipes');
    
    viralClips = clipsArray.slice(0, 10).map(clip => ({
      start: Math.max(0, Math.min(clip.startTime, videoDuration - 5)),
      end: Math.min(videoDuration, Math.max(clip.startTime + 12, clip.endTime)),
      title: clip.title || `Momento viral ${Math.floor(clip.startTime)}s`,
      descriptionWithHashtags: clip.descriptionWithHashtags || "#cortes #podcast #viral",
      transcript: Array.isArray(clip.transcript) ? clip.transcript : []
    })).filter(clip => clip.end - clip.start >= 5);
    
    // Se faltar clipes, complementa com fallback inteligente
    if (viralClips.length < 10) {
      await generateIntelligentFallbackClips();
    }
    
    statusDiv.textContent = `🎉 10 clipes gerados com sucesso! Acesse a aba 2.`;
    document.querySelector('.tab-btn[data-tab="tab2"]').disabled = false;
    switchToTab('tab2');
    renderClipsList();
    
  } catch (err) {
    console.error(err);
    statusDiv.textContent = `❌ Falha na IA: ${err.message}. Usando fallback inteligente baseado em áudio.`;
    await generateIntelligentFallbackClips();
    document.querySelector('.tab-btn[data-tab="tab2"]').disabled = false;
    switchToTab('tab2');
    renderClipsList();
  } finally {
    analyzeBtn.disabled = false;
  }
}

analyzeBtn.addEventListener('click', analyzeVideoWithGemini);

// ------------------------------------------------------
// Fallback inteligente (análise de atividade de áudio - RMS)
// ------------------------------------------------------
async function generateIntelligentFallbackClips() {
  statusDiv.textContent = '🔊 Analisando áudio para encontrar os melhores momentos...';
  try {
    const activity = await analyzeAudioActivity(uploadedVideoFile, videoDuration);
    // Remove primeiros 10 segundos
    const validWindows = [];
    const step = 1.0;
    for (let t = 10; t < videoDuration - 12; t += step) {
      let avgAct = 0;
      let count = 0;
      for (let dt = 0; dt < 6; dt++) {
        let idx = Math.floor(t + dt);
        if (idx < activity.length) {
          avgAct += activity[idx];
          count++;
        }
      }
      avgAct = avgAct / count;
      validWindows.push({ start: t, activity: avgAct });
    }
    validWindows.sort((a,b) => b.activity - a.activity);
    const selected = [];
    for (let win of validWindows) {
      if (selected.length >= 10) break;
      let overlap = false;
      for (let s of selected) {
        if (Math.abs(s.start - win.start) < 8) { overlap = true; break; }
      }
      if (!overlap) {
        let end = Math.min(win.start + 18, videoDuration);
        selected.push({ start: win.start, end: end });
      }
    }
    if (selected.length < 10) {
      for (let i = selected.length; i < 10; i++) {
        let start = 15 + Math.random() * (videoDuration - 30);
        let end = Math.min(start + 18, videoDuration);
        selected.push({ start, end });
      }
    }
    
    viralClips = selected.map((seg, idx) => ({
      start: seg.start,
      end: seg.end,
      title: `🔥 Corte viral #${idx+1}`,
      descriptionWithHashtags: "#podcastclips #viral #humor #cortes",
      transcript: []   // sem transcript no fallback
    }));
    statusDiv.textContent = '⚠️ IA indisponível, usamos cortes baseados em picos de áudio. Edite os títulos se quiser.';
  } catch (err) {
    console.error("Falha na análise de áudio:", err);
    viralClips = [];
    for (let i = 0; i < 10; i++) {
      let start = 15 + Math.random() * (videoDuration - 30);
      let end = Math.min(start + 18, videoDuration);
      viralClips.push({
        start, end,
        title: `🔥 Corte #${i+1}`,
        descriptionWithHashtags: "#cortes #ia",
        transcript: []
      });
    }
    statusDiv.textContent = '⚠️ Usando cortes aleatórios (evitando início). Edite os títulos.';
  }
}

async function analyzeAudioActivity(videoFile, duration) {
  return new Promise((resolve, reject) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const fileReader = new FileReader();
    fileReader.onload = async function(evt) {
      try {
        const arrayBuffer = evt.target.result;
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const samplesPerSecond = sampleRate;
        const totalSeconds = Math.min(duration, audioBuffer.duration);
        const rmsPerSecond = [];
        
        for (let sec = 0; sec < totalSeconds; sec++) {
          let startSample = sec * samplesPerSecond;
          let endSample = Math.min(startSample + samplesPerSecond, channelData.length);
          let sumSq = 0;
          for (let i = startSample; i < endSample; i++) {
            sumSq += channelData[i] * channelData[i];
          }
          let rms = Math.sqrt(sumSq / (endSample - startSample));
          rmsPerSecond.push(rms);
        }
        audioContext.close();
        resolve(rmsPerSecond);
      } catch(e) { reject(e); }
    };
    fileReader.onerror = reject;
    fileReader.readAsArrayBuffer(videoFile);
  });
}

// ------------------------------------------------------
// Renderização da lista de clipes (editável)
// ------------------------------------------------------
function renderClipsList() {
  const container = document.getElementById('clipsList');
  if (!container) return;
  container.innerHTML = '';
  
  viralClips.forEach((clip, idx) => {
    const card = document.createElement('div');
    card.className = 'clip-card';
    card.dataset.index = idx;
    
    card.innerHTML = `
      <div class="clip-number">🔊 CLIPE ${idx+1}</div>
      <input type="text" class="clip-title" value="${escapeHtml(clip.title)}" data-field="title" data-idx="${idx}">
      <textarea rows="2" class="clip-desc" data-field="desc" data-idx="${idx}">${escapeHtml(clip.descriptionWithHashtags)}</textarea>
      <div class="time-badge">⏱️ ${clip.start.toFixed(1)}s → ${clip.end.toFixed(1)}s (${(clip.end-clip.start).toFixed(1)}s)</div>
      <button class="download-clip-btn" data-idx="${idx}">📥 Baixar clipe (MP4)</button>
    `;
    
    container.appendChild(card);
    
    const titleInput = card.querySelector('.clip-title');
    const descTextarea = card.querySelector('.clip-desc');
    titleInput.addEventListener('change', (e) => { viralClips[idx].title = e.target.value; });
    descTextarea.addEventListener('change', (e) => { viralClips[idx].descriptionWithHashtags = e.target.value; });
    
    const downloadBtn = card.querySelector('.download-clip-btn');
    downloadBtn.addEventListener('click', () => renderSingleClip(idx));
  });
}

function escapeHtml(str) {
  if(!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if(m === '&') return '&amp;';
    if(m === '<') return '&lt;';
    if(m === '>') return '&gt;';
    return m;
  });
}

// ------------------------------------------------------
// Renderização de um clipe (crop inteligente + legenda dinâmica)
// ------------------------------------------------------
async function renderSingleClip(clipIndex) {
  if (isRendering) {
    statusDiv.textContent = '⏳ Já existe um clipe sendo gerado, aguarde...';
    return;
  }
  const clip = viralClips[clipIndex];
  if (!clip || !uploadedVideoFile) {
    alert('Vídeo não disponível. Faça upload novamente.');
    return;
  }
  
  const clipDurationSec = clip.end - clip.start;
  if (clipDurationSec <= 0) {
    statusDiv.textContent = `❌ Duração inválida para o clipe ${clipIndex+1}`;
    return;
  }

  isRendering = true;
  const btn = document.querySelector(`.download-clip-btn[data-idx="${clipIndex}"]`);
  const originalText = btn.innerHTML;
  btn.innerHTML = '<div class="loading-spinner"></div> Renderizando...';
  btn.disabled = true;
  statusDiv.textContent = `🎬 Renderizando clipe ${clipIndex+1} com crop inteligente e legendas...`;
  
  let videoUrl = null;
  let audioCtx = null;
  let srcNode = null;
  let recorder = null;
  let animationId = null;
  let timeoutId = null;

  try {
    videoUrl = URL.createObjectURL(uploadedVideoFile);
    sourceVideo.src = videoUrl;
    await sourceVideo.load();
    sourceVideo.currentTime = clip.start;
    await new Promise(resolve => sourceVideo.addEventListener('seeked', resolve, { once: true }));
    
    // Configura áudio
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    srcNode = audioCtx.createMediaElementSource(sourceVideo);
    const destNode = audioCtx.createMediaStreamDestination();
    srcNode.connect(destNode);
    srcNode.connect(audioCtx.destination);
    
    const canvasStream = renderCanvas.captureStream(RENDER_CONFIG.FPS);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destNode.stream.getAudioTracks()
    ]);
    
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
    recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: RENDER_CONFIG.BITRATE });
    let chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    
    const clipPromise = new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `clip_${clipIndex+1}_viral.webm`;
        a.click();
        URL.revokeObjectURL(url);
        resolve();
      };
    });
    
    recorder.start();
    sourceVideo.muted = false;
    await sourceVideo.play();
    await audioCtx.resume();
    
    const startTime = performance.now();
    const clipDurationMs = clipDurationSec * 1000;
    // Efeito de zoom sutil (1.0 -> 1.05)
    const startZoom = 1.0;
    const endZoom = 1.05;
    
    // Prepara dados da legenda (transcript)
    const transcript = clip.transcript || [];
    const hasTranscript = transcript.length > 0;
    // Se não tem transcript, usa a descrição como texto fixo
    const fallbackText = clip.descriptionWithHashtags.split('#')[0].trim() || "🔥 Cortes imperdíveis";
    
    function drawFrame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / clipDurationMs);
      const relativeTime = clip.start + (elapsed / 1000); // tempo absoluto no vídeo
      
      // ---- Crop inteligente (cover + zoom) ----
      const videoWidth = sourceVideo.videoWidth;
      const videoHeight = sourceVideo.videoHeight;
      const canvasWidth = renderCanvas.width;
      const canvasHeight = renderCanvas.height;
      
      const scaleX = canvasWidth / videoWidth;
      const scaleY = canvasHeight / videoHeight;
      const scale = Math.max(scaleX, scaleY);
      let scaledWidth = videoWidth * scale;
      let scaledHeight = videoHeight * scale;
      
      // Aplica zoom progressivo
      const zoom = startZoom + (endZoom - startZoom) * progress;
      scaledWidth *= zoom;
      scaledHeight *= zoom;
      
      const offsetX = (canvasWidth - scaledWidth) / 2;
      const offsetY = (canvasHeight - scaledHeight) / 2;
      
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      ctx.save();
      ctx.drawImage(sourceVideo, offsetX, offsetY, scaledWidth, scaledHeight);
      
      // ---- Gradiente de escurecimento nas bordas ----
      const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
      gradient.addColorStop(0, 'rgba(0,0,0,0.2)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      
      // ---- Título no topo (com envelope) ----
      const titleOpacity = Math.min(1, elapsed / 300);
      ctx.font = RENDER_CONFIG.TITLE_FONT;
      ctx.textAlign = 'center';
      const titleText = clip.title.toUpperCase();
      const titleWidth = ctx.measureText(titleText).width;
      const titleBoxWidth = Math.min(titleWidth + 60, canvasWidth - 80);
      const titleBoxHeight = 90;
      const titleBoxX = (canvasWidth - titleBoxWidth) / 2;
      const titleBoxY = 60;
      
      ctx.fillStyle = RENDER_CONFIG.COLORS.titleBg;
      ctx.fillRect(titleBoxX, titleBoxY, titleBoxWidth, titleBoxHeight);
      ctx.fillStyle = RENDER_CONFIG.COLORS.titleText;
      ctx.shadowColor = RENDER_CONFIG.COLORS.shadow;
      ctx.shadowBlur = 10;
      ctx.fillText(titleText, canvasWidth/2, titleBoxY + 58);
      ctx.shadowBlur = 0;
      
      // ---- Legendas dinâmicas (baseadas no transcript ou fallback) ----
      if (hasTranscript) {
        // Encontra a palavra ativa no momento
        let activeWordObj = null;
        for (let i = 0; i < transcript.length; i++) {
          const w = transcript[i];
          if (relativeTime >= w.start && relativeTime <= w.end) {
            activeWordObj = w;
            break;
          }
        }
        
        // Constrói o texto antes da palavra ativa
        let beforeText = '';
        let currentWordIndex = -1;
        for (let i = 0; i < transcript.length; i++) {
          if (transcript[i] === activeWordObj) {
            currentWordIndex = i;
            break;
          }
          beforeText += transcript[i].word + ' ';
        }
        const activeWord = activeWordObj ? activeWordObj.word : '';
        
        // Se não encontrou palavra ativa, mostra o texto completo
        let fullText = beforeText + activeWord;
        if (!activeWordObj) {
          fullText = transcript.map(w => w.word).join(' ');
        }
        
        const legendY = canvasHeight - 200;
        ctx.font = RENDER_CONFIG.SUBTITLE_FONT;
        
        if (activeWordObj && activeWord) {
          // Medir largura do texto antes
          const beforeWidth = ctx.measureText(beforeText).width;
          // Desenha o texto normal (antes da palavra ativa)
          ctx.fillStyle = RENDER_CONFIG.COLORS.subtitleNormal;
          ctx.shadowBlur = 6;
          ctx.fillText(beforeText, canvasWidth/2 - beforeWidth/2, legendY);
          
          // Desenha a palavra ativa com efeito de pulso
          const pulse = 1 + Math.sin(now * 0.02) * 0.06;
          ctx.save();
          ctx.translate(canvasWidth/2 + beforeWidth/2, legendY);
          ctx.scale(pulse, pulse);
          ctx.fillStyle = RENDER_CONFIG.COLORS.subtitleActive;
          ctx.shadowBlur = 15;
          ctx.fillText(activeWord, 0, 0);
          ctx.restore();
        } else {
          // Sem palavra ativa: mostra todo o texto estático
          ctx.fillStyle = RENDER_CONFIG.COLORS.subtitleNormal;
          ctx.shadowBlur = 6;
          ctx.fillText(fullText, canvasWidth/2, legendY);
        }
      } else {
        // Fallback: mostra a descrição como legenda estática (sem animação)
        const legendText = fallbackText;
        ctx.font = RENDER_CONFIG.SUBTITLE_FONT;
        ctx.fillStyle = RENDER_CONFIG.COLORS.subtitleNormal;
        ctx.shadowBlur = 6;
        const legendY = canvasHeight - 200;
        ctx.fillText(legendText, canvasWidth/2, legendY);
      }
      
      ctx.restore();
      
      // Continua ou finaliza
      if (progress < 1) {
        animationId = requestAnimationFrame(drawFrame);
      } else {
        if (animationId) cancelAnimationFrame(animationId);
        sourceVideo.pause();
        if (recorder && recorder.state === 'recording') recorder.stop();
      }
    }
    
    timeoutId = setTimeout(() => {
      if (recorder && recorder.state === 'recording') {
        console.warn('Timeout de segurança: parando recorder');
        sourceVideo.pause();
        recorder.stop();
      }
    }, clipDurationMs + 500);
    
    animationId = requestAnimationFrame(drawFrame);
    await clipPromise;
    
    statusDiv.textContent = `✅ Clipe ${clipIndex+1} baixado!`;
  } catch (err) {
    console.error(err);
    statusDiv.textContent = `❌ Erro ao renderizar clipe: ${err.message}`;
    if (recorder && recorder.state === 'recording') recorder.stop();
  } finally {
    isRendering = false;
    btn.innerHTML = originalText;
    btn.disabled = false;
    if (timeoutId) clearTimeout(timeoutId);
    if (animationId) cancelAnimationFrame(animationId);
    sourceVideo.pause();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (audioCtx) audioCtx.close();
  }
}

// ------------------------------------------------------
// Utilitários de tabs
// ------------------------------------------------------
function switchToTab(tabId) {
  tabContents.forEach(tab => tab.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  tabBtns.forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-tab') === tabId) btn.classList.add('active');
  });
}

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.getAttribute('data-tab');
    if (!btn.disabled) switchToTab(tabId);
  });
});

// ------------------------------------------------------
// Inicialização
// ------------------------------------------------------
loadStoredKey();
if (!currentApiKey) statusDiv.textContent = '🔐 Insira sua chave Gemini e depois faça upload do vídeo.';