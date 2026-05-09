// ⚙️ CONFIGURAÇÃO
const VIDEO_URL = 'buck.mp4';

// UI elements
const apiBox = document.getElementById('apiBox');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const sourceVideo = document.getElementById('sourceVideo');
const canvas = document.getElementById('renderCanvas');
const ctx = canvas.getContext('2d');
const durSlider = document.getElementById('durSlider');
const durLabel = document.getElementById('durLabel');
const analyzeBtn = document.getElementById('analyzeBtn');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusDiv = document.getElementById('status');

// State
let selectedClip = null; // { startTime, endTime, caption }
let memeDuration = 15;
let isGenerating = false;
let mediaRecorder = null;
let chunks = [];
let currentApiKey = '';

// ---------- Gerência segura da chave ----------
function loadApiKey() {
  const saved = sessionStorage.getItem('gemini_api_key');
  if (saved) {
    currentApiKey = saved;
    apiBox.classList.add('hidden');
    return true;
  }
  return false;
}

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    alert('Cole uma chave válida.');
    return;
  }
  sessionStorage.setItem('gemini_api_key', key);
  currentApiKey = key;
  apiBox.classList.add('hidden');
  checkReady();
}
saveKeyBtn.addEventListener('click', saveApiKey);
apiKeyInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') saveApiKey();
});

// ---------- Inicialização ----------
async function init() {
  if (!loadApiKey()) {
    statusDiv.textContent = '🔑 Insira sua chave da API Gemini para continuar.';
    analyzeBtn.disabled = true;
    return;
  }
  checkReady();
}

function checkReady() {
  if (!currentApiKey) {
    statusDiv.textContent = '🔑 Chave não fornecida.';
    analyzeBtn.disabled = true;
    return;
  }
  if (sourceVideo.src !== VIDEO_URL && !sourceVideo.src.endsWith(VIDEO_URL)) {
    loadVideo();
  } else {
    analyzeBtn.disabled = false;
  }
}

async function loadVideo() {
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

// ---------- Slider de duração ----------
durSlider.addEventListener('input', () => {
  memeDuration = parseInt(durSlider.value);
  durLabel.textContent = memeDuration;
});

// ---------- Conversão para base64 ----------
async function videoUrlToBase64(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result.split(',')[1];
      resolve({ base64: b64, mimeType: blob.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---------- Frases absurdas de fallback ----------
const fallbackAbsurdCaptions = [
  "Quando a geladeira descongela sozinha e você descobre que era o primo",
  "O pão que meu avô escondeu atrás da TV em 2003 ainda tá lá",
  "Eu e o espiritual ballroom pós‑moderno indo ao mercado",
  "A entidade quântica disse que era só um teste",
  "Toda vez que chove, o wifi da rua fica emocionado",
  "Meu CPF deu erro no além",
  "Até o Google Maps se perdeu aqui dentro",
  "Quem lacra não lucra, mas quem usa fantasia de cavalo lucra?",
  "O universo é um Transformer desmontado"
];

function getRandomAbsurdCaption() {
  return fallbackAbsurdCaptions[Math.floor(Math.random() * fallbackAbsurdCaptions.length)];
}

// ---------- Análise com Gemini (prompt ABSURDO) ----------
analyzeBtn.addEventListener('click', async () => {
  if (!currentApiKey || !sourceVideo.src) return;
  analyzeBtn.disabled = true;
  generateBtn.disabled = true;
  statusDiv.textContent = '🤖 Gerando frase nonsense com IA...';

  try {
    const { base64, mimeType } = await videoUrlToBase64(VIDEO_URL);

    // ✨ NOVO PROMPT – pedindo humor absurdo, frase desconexa mas ligada ao vídeo
    const absurdPrompt = `
      Analise este vídeo. Identifique um trecho de aproximadamente ${memeDuration} segundos que tenha algum elemento visual ou sonoro marcante (pode ser uma expressão, movimento, objeto inusitado, etc.).

      Com base nesse trecho, crie uma **frase curta e engraçada**, no estilo "meme nonsense brasileiro", com quebra de expectativa bizarra. A frase deve parecer sem sentido, mas ter alguma relação sutil com o que aparece na cena.

      Retorne **apenas um JSON** com os campos:
      - startTime: número (segundos do início do trecho)
      - endTime: número (segundos do fim do trecho)
      - caption: string com a frase absurda (máximo 15 palavras, em português)

      Exemplo de caption: "Quando o pão de queijo começa a levitar na airfryer"
      Formato JSON: {"startTime": 5.0, "endTime": 20.0, "caption": "frase aqui"}
    `;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: absurdPrompt },
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
    const resultText = data.candidates[0].content.parts[0].text;

    // Extrair JSON
    let jsonStr = resultText.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
    if (!jsonStr) jsonStr = resultText.match(/({[\s\S]*})/)?.[1];
    if (!jsonStr) throw new Error('Resposta da IA não contém JSON válido.\n' + resultText);

    const clip = JSON.parse(jsonStr.trim());

    // Validação
    if (typeof clip.startTime !== 'number' ||
        typeof clip.endTime !== 'number' ||
        typeof clip.caption !== 'string') {
      throw new Error('JSON inválido: campos ausentes ou com tipos errados');
    }

    // Verifica se a frase é muito sem graça (ex: maior que 30 palavras, sem vírgula, etc.)
    // Se for muito descritiva, substitui por fallback absurdo
    if (clip.caption.length > 100 || clip.caption.split(' ').length > 20) {
      console.warn('Frase retornada parece descritiva, usando fallback.');
      clip.caption = getRandomAbsurdCaption();
    }

    selectedClip = clip;
    statusDiv.textContent = `✅ Trecho absurdo: "${selectedClip.caption}" (${selectedClip.startTime.toFixed(1)}s – ${selectedClip.endTime.toFixed(1)}s)`;
    generateBtn.disabled = false;
  } catch (err) {
    console.error('Erro na análise:', err);
    // Fallback total: usar frase aleatória e recortar um trecho automático
    statusDiv.textContent = '⚠️ IA falhou, usando frase aleatória.';
    selectedClip = {
      startTime: 0,
      endTime: memeDuration,
      caption: getRandomAbsurdCaption()
    };
    generateBtn.disabled = false;
  } finally {
    analyzeBtn.disabled = false;
  }
});

// ---------- Geração do meme (renderização) ----------
generateBtn.addEventListener('click', () => {
  if (!selectedClip) return;
  startMemeGeneration();
});

function wrapTextCentered(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const w of words) {
    const test = current ? current + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function startMemeGeneration() {
  if (isGenerating) return;
  isGenerating = true;
  generateBtn.disabled = true;
  downloadBtn.disabled = true;
  chunks = [];

  sourceVideo.currentTime = selectedClip.startTime;
  await new Promise(r => sourceVideo.addEventListener('seeked', r, { once: true }));

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const srcNode = audioCtx.createMediaElementSource(sourceVideo);
  const destNode = audioCtx.createMediaStreamDestination();
  srcNode.connect(destNode);
  srcNode.connect(audioCtx.destination);

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destNode.stream.getAudioTracks()
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8' : 'video/webm';
  mediaRecorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 4000000 });
  mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    downloadBtn.disabled = false;
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `meme_absurdo_${Date.now()}.webm`;
      a.click();
    };
    statusDiv.textContent = '✅ Meme absurdo pronto! Clique em Baixar.';
    isGenerating = false;
    generateBtn.disabled = false;
  };

  mediaRecorder.start();
  sourceVideo.muted = false;
  await sourceVideo.play();

  const start = performance.now();
  const clipMs = (selectedClip.endTime - selectedClip.startTime) * 1000;

  function drawLoop(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / clipMs, 1);

    ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);

    // Texto centralizado e com quebra
    ctx.font = 'bold 32px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3.5;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 12;

    const maxWidth = canvas.width - 60;
    const lines = wrapTextCentered(ctx, selectedClip.caption, maxWidth);
    const lineHeight = 44;
    const totalHeight = lines.length * lineHeight;
    let y = canvas.height / 2 - totalHeight / 2 + lineHeight / 2;

    lines.forEach(line => {
      ctx.strokeText(line, canvas.width / 2, y);
      ctx.fillText(line, canvas.width / 2, y);
      y += lineHeight;
    });
    ctx.shadowBlur = 0;

    if (progress < 1 && sourceVideo.currentTime < selectedClip.endTime) {
      requestAnimationFrame(drawLoop);
    } else {
      sourceVideo.pause();
      mediaRecorder.stop();
    }
  }

  requestAnimationFrame(drawLoop);
  statusDiv.textContent = '🎬 Renderizando meme nonsense...';
}

// ---------- Boot ----------
init();