// ============================================================
// EdgeTTS - Browser-based Microsoft Edge Text-to-Speech Client
// Uses WebSocket to speech.platform.bing.com (no server needed)
// ============================================================

const EdgeTTS = (() => {

  const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
  const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

  // Korean voices
  const VOICES = {
    female: 'ko-KR-SunHiNeural',
    male: 'ko-KR-InJoonNeural'
  };

  // Audio cache (text+speaker → Blob URL)
  const cache = new Map();
  const MAX_CACHE = 200;

  function uuid() {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  function escapeXml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function buildSSML(text, speaker) {
    const voice = speaker === 'B' ? VOICES.male : VOICES.female;
    const rate = '+25%';
    const pitch = speaker === 'B' ? '-10Hz' : '+30Hz';

    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ko-KR'>` +
      `<voice name='${voice}'>` +
      `<prosody rate='${rate}' pitch='${pitch}'>${escapeXml(text)}</prosody>` +
      `</voice></speak>`;
  }

  function buildConfigMessage() {
    return `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
      JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: 'false',
                wordBoundaryEnabled: 'false'
              },
              outputFormat: OUTPUT_FORMAT
            }
          }
        }
      });
  }

  function buildSSMLMessage(requestId, ssml) {
    return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
  }

  /**
   * Synthesize text to audio Blob via Edge TTS WebSocket
   * @param {string} text - Korean text to speak
   * @param {string} speaker - 'A' (female) or 'B' (male)
   * @param {number} timeout - Timeout in ms (default 15000)
   * @returns {Promise<Blob>} Audio blob (MP3)
   */
  function synthesize(text, speaker = 'A', timeout = 15000) {
    const cacheKey = `${speaker}:${text}`;
    if (cache.has(cacheKey)) {
      return Promise.resolve(cache.get(cacheKey));
    }

    return new Promise((resolve, reject) => {
      const connId = uuid();
      const requestId = uuid();
      const url = `${WSS_URL}?TrustedClientToken=${TOKEN}&ConnectionId=${connId}`;

      let ws;
      let audioChunks = [];
      let resolved = false;
      let timer;

      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(new Error('WebSocket not supported or blocked'));
        return;
      }

      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { ws.close(); } catch(e) {}
          reject(new Error('Edge TTS timeout'));
        }
      }, timeout);

      ws.onopen = () => {
        // Send config
        ws.send(buildConfigMessage());
        // Send SSML
        const ssml = buildSSML(text, speaker);
        ws.send(buildSSMLMessage(requestId, ssml));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          // Text message
          if (event.data.includes('Path:turn.end')) {
            // Synthesis complete
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              try { ws.close(); } catch(e) {}

              if (audioChunks.length > 0) {
                const blob = new Blob(audioChunks, { type: 'audio/mpeg' });
                // Cache it
                if (cache.size >= MAX_CACHE) {
                  const firstKey = cache.keys().next().value;
                  const oldUrl = cache.get(firstKey);
                  if (oldUrl && typeof oldUrl === 'string' && oldUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(oldUrl);
                  }
                  cache.delete(firstKey);
                }
                cache.set(cacheKey, blob);
                resolve(blob);
              } else {
                reject(new Error('No audio data received'));
              }
            }
          }
        } else if (event.data instanceof Blob) {
          // Binary message - contains header + audio data
          event.data.arrayBuffer().then(buffer => {
            const view = new DataView(buffer);
            if (buffer.byteLength < 2) return;
            const headerLen = view.getUint16(0);
            if (buffer.byteLength > headerLen + 2) {
              const audioData = buffer.slice(headerLen + 2);
              audioChunks.push(audioData);
            }
          });
        }
      };

      ws.onerror = (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(new Error('Edge TTS WebSocket error'));
        }
      };

      ws.onclose = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          if (audioChunks.length > 0) {
            const blob = new Blob(audioChunks, { type: 'audio/mpeg' });
            cache.set(cacheKey, blob);
            resolve(blob);
          } else {
            reject(new Error('Edge TTS connection closed without data'));
          }
        }
      };
    });
  }

  /**
   * Play audio blob
   * @param {Blob} blob - Audio blob
   * @returns {Promise<HTMLAudioElement>} Audio element (for stop control)
   */
  function playBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio._blobUrl = url;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve(audio);
      };
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error('Audio playback error'));
      };
      audio.play().then(() => resolve(audio)).catch(reject);
    });
  }

  /**
   * Synthesize and play text
   * @param {string} text - Korean text
   * @param {string} speaker - 'A' or 'B'
   * @returns {Promise<HTMLAudioElement>}
   */
  async function speak(text, speaker = 'A') {
    const blob = await synthesize(text, speaker);
    return playBlob(blob);
  }

  /**
   * Test if Edge TTS is available
   * @returns {Promise<boolean>}
   */
  async function isAvailable() {
    try {
      const blob = await synthesize('안녕', 'A', 8000);
      return blob && blob.size > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Clear audio cache
   */
  function clearCache() {
    cache.forEach((blob, key) => {
      // No blob URLs to revoke since we store Blobs directly
    });
    cache.clear();
  }

  return {
    synthesize,
    playBlob,
    speak,
    isAvailable,
    clearCache,
    VOICES,
    cache
  };

})();
