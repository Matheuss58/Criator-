// ⚙️ CONFIGURAÇÃO (SUBSTITUA COM SEUS DADOS)
const API_KEY = 'AIzaSyB4PSg_-rEUh2i5cKTw3KTgvfcZTGU73x0'; // 👈 Cole sua chave Gemini aqui (apenas para testes)
const VIDEO_URL = 'buck.mp4'; // 👈 Nome do vídeo na mesma pasta

// Elementos da UI
const sourceVideo = document.getElementById('sourceVideo');
const canvas = document.getElementById('renderCanvas');
const ctx = canvas.getContext('2d');
const durSlider = document.getElementById('durSlider');
const durLabel = document.getElementById('durLabel');
const analyzeBtn = document.getElementById('analyzeBtn');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusDiv = document.getElementById('status');

// Variáveis de estado
let selectedClip = null;
let memeDuration = 15;
let isGenerating = false;
let mediaRecorder = null;
let chunks = [];

// ---- INICIALIZAÇÃO ----
async function init() {
  if (!API_KEY) {
    statusDiv.textContent = '⚠️ Chave API não configurada. Abra script.js e insira sua chave.';
    analyzeBtn.disabled = true;
    return;
  }
  try {
    sourceVideo.src = VIDEO_URL;
    await new Promise((resolve, reject) => {
      sourceVideo.addEventListener('loadedmetadata', resolve, { once: true });
      sourceVideo.addEventListener('error', () => reject(new Error('Vídeo não encontrado')), { once: true });
      sourceVideo.load();
    });
    statusDiv.textContent = `✅ Vídeo carregado (${sourceVideo.duration.toFixed(1)}s). Pronto para análise.`;
    analyzeBtn.disabled = false;
  } catch (e) {
    statusDiv.textContent = '❌ Vídeo não encontrado. Coloque buck.mp4 na mesma pasta.';
    analyzeBtn.disabled = true;
  }
}

// ---- CONTROLE DE DURAÇÃO ----
durSlider.addEventListener('input', () => {
  memeDuration = parseInt(durSlider.value);
  durLabel.textContent = memeDuration;
});

// ---- CONVERSÃO DE VÍDEO PARA BASE64 ----
async function videoUrlToBase64(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve({ base64, mimeType: blob.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---- ANÁLISE COM GEMINI (CORRIGIDA) ----
analyzeBtn.addEventListener('click', async () => {
  if (!API_KEY || !sourceVideo.src) return;
  analyzeBtn.disabled = true;
  generateBtn.disabled = true;
  statusDiv.textContent = '🤖 Analisando vídeo com IA...';

  try {
    // Converte o vídeo local para base64
    const { base64, mimeType } = await videoUrlToBase64(VIDEO_URL);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `Analise este vídeo. Identifique o trecho mais engraçado ou impactante de aproximadamente ${memeDuration} segundos. Retorne apenas um JSON com startTime, endTime e caption (legenda curta em português). Formato exato: {"startTime": 10.5, "endTime": 25.5, "caption": "texto aqui"}` },
              { inline_data: { mime_type: mimeType, data: base64 } }
            ]
          }]
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API Gemini falhou (${response.status}): ${err}`);
    }

    const data = await response.json();
    console.log('Resposta completa da IA:', data);
    const resultText = data.candidates[0].content.parts[0].text;
    console.log('Texto retornado:', resultText);

    // Tenta extrair JSON de várias formas
    let jsonStr = resultText.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
    if (!jsonStr) jsonStr = resultText.match(/({[\s\S]*})/)?.[1];
    if (!jsonStr) throw new Error('Resposta da IA não contém JSON válido.\n' + resultText);

    selectedClip = JSON.parse(jsonStr.trim());

    // Validação básica
    if (typeof selectedClip.startTime !== 'number' || typeof selectedClip.endTime !== 'number' || typeof selectedClip.caption !== 'string') {
      throw new Error('JSON inválido: campos ausentes ou com tipos errados');
    }

    statusDiv.textContent = `✅ Trecho: "${selectedClip.caption}" (${selectedClip.startTime.toFixed(1)}s – ${selectedClip.endTime.toFixed(1)}s)`;
    generateBtn.disabled = false;
  } catch (err) {
    console.error('Erro na análise:', err);
    statusDiv.textContent = '❌ ' + err.message;
  } finally {
    analyzeBtn.disabled = false;
  }
});

// ---- GERAÇÃO DO MEME (CORTE + RENDER) ----
generateBtn.addEventListener('click', () => {
  if (!selectedClip) return;
  startMemeGeneration();
});

async function startMemeGeneration() {
  if (isGenerating) return;
  isGenerating = true;
  generateBtn.disabled = true;
  downloadBtn.disabled = true;
  chunks = [];

  sourceVideo.currentTime = selectedClip.startTime;
  await new Promise(r => sourceVideo.addEventListener('seeked', r, { once: true }));

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const sourceNode = audioCtx.createMediaElementSource(sourceVideo);
  const destNode = audioCtx.createMediaStreamDestination();
  sourceNode.connect(destNode);
  sourceNode.connect(audioCtx.destination);

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destNode.stream.getAudioTracks()
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ?
    'video/webm;codecs=vp8' : 'video/webm';
  mediaRecorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 4000000 });
  mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    downloadBtn.disabled = false;
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `meme_ia_${Date.now()}.webm`;
      a.click();
    };
    statusDiv.textContent = '✅ Meme gerado! Clique em Baixar.';
    isGenerating = false;
    generateBtn.disabled = false;
  };

  mediaRecorder.start();
  sourceVideo.muted = false;
  sourceVideo.play();

  const startTime = performance.now();
  const clipDuration = (selectedClip.endTime - selectedClip.startTime) * 1000;

  function drawLoop(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / clipDuration, 1);

    ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 36px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 10;
    const caption = selectedClip.caption;
    ctx.strokeText(caption, canvas.width/2, canvas.height - 80);
    ctx.fillText(caption, canvas.width/2, canvas.height - 80);
    ctx.shadowBlur = 0;

    if (progress < 1 && sourceVideo.currentTime < selectedClip.endTime) {
      requestAnimationFrame(drawLoop);
    } else {
      sourceVideo.pause();
      mediaRecorder.stop();
    }
  }

  requestAnimationFrame(drawLoop);
  statusDiv.textContent = '🎬 Renderizando meme...';
}

// ---- BOOT ----
init();