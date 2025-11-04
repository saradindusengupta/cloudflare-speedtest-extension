// Content script injected on https://fast.com/*
// Goal: observe the DOM for speed value updates and send streaming updates
// and a final result back to the extension.

(function () {
  const MAX_IDLE_MS = 5000; // If no changes for this duration after first reading, consider done
  const HARD_STOP_MS = 25000; // Hard stop to avoid running too long

    let metrics = {
      download: null,
      upload: null,
      latency: null,
      jitter: null
    };
  let lastChangeTs = Date.now();
  let sawAny = false;

  function parseNumberFromText(text) {
    if (!text) return null;
    const match = text.replace(/[,\s]/g, '').match(/([0-9]*\.?[0-9]+)/);
    if (!match) return null;
    const v = parseFloat(match[1]);
    return Number.isFinite(v) ? v : null;
  }

  function readUnits() {
    // Try common selectors used on fast.com; fallback to 'Mbps'
    const unitNode = document.querySelector('#speed-units, .speed-units, [data-test-id="speed-units"]');
    const unit = unitNode?.textContent?.trim();
    return unit || 'Mbps';
  }

    function extractAllMetrics() {
      // Extract download speed (main speed value)
      const download = extractSpeedCandidate();
    
      // Extract upload speed
      let upload = null;
      const uploadSelectors = [
        '[data-test-id="upload-value"]',
        '.upload-speed',
        '#upload-value'
      ];
      for (const sel of uploadSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const v = parseNumberFromText(el.textContent || '');
          if (v != null) {
            upload = v;
            break;
          }
        }
      }
    
      // Extract latency (unloaded/loaded)
      let latency = null;
      const latencySelectors = [
        '[data-test-id="latency-value"]',
        '.latency-value',
        '#latency-value',
        '[data-test-id="loaded-latency"]'
      ];
      for (const sel of latencySelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const v = parseNumberFromText(el.textContent || '');
          if (v != null) {
            latency = v;
            break;
          }
        }
      }
    
      // Extract jitter
      let jitter = null;
      const jitterSelectors = [
        '[data-test-id="jitter-value"]',
        '.jitter-value',
        '#jitter-value'
      ];
      for (const sel of jitterSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const v = parseNumberFromText(el.textContent || '');
          if (v != null) {
            jitter = v;
            break;
          }
        }
      }
    
      return { download, upload, latency, jitter };
    }

  function extractSpeedCandidate() {
    // Try a few likely selectors, otherwise find the largest numeric text on the page
    const selectors = [
      '#speed-value',
      '.speed-value',
      '[data-test-id="speed-value"]',
      '.your-speed',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const v = parseNumberFromText(el.textContent || '');
        if (v != null) return v;
      }
    }
    // Fallback: scan numeric texts, pick the largest reasonable value
    let best = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const v = parseNumberFromText(node.textContent || '');
      if (v != null && v < 1_000_000) {
        if (best == null || v > best) best = v;
      }
    }
    return best;
  }

  function sendUpdate(currentMetrics) {
    const units = readUnits();
    chrome.runtime.sendMessage({ 
      type: 'FAST_SPEED_UPDATE', 
      download: currentMetrics.download,
      upload: currentMetrics.upload,
      latency: currentMetrics.latency,
      jitter: currentMetrics.jitter,
      units, 
      ts: Date.now() 
    });
  }

  function sendDone() {
    chrome.runtime.sendMessage({ 
      type: 'FAST_SPEED_DONE', 
      download: metrics.download,
      upload: metrics.upload,
      latency: metrics.latency,
      jitter: metrics.jitter,
      units: readUnits(), 
      ts: Date.now() 
    });
  }

  // Observe mutations for dynamic updates
  const observer = new MutationObserver(() => {
    const current = extractAllMetrics();
    if (current.download != null) {
      sawAny = true;
      lastChangeTs = Date.now();
      // Update best values
      if (metrics.download == null || current.download > metrics.download) metrics.download = current.download;
      if (current.upload != null) metrics.upload = current.upload;
      if (current.latency != null) metrics.latency = current.latency;
      if (current.jitter != null) metrics.jitter = current.jitter;
      sendUpdate(current);
    }
  });

  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });

  // Also poll at a low frequency in case some updates don’t trigger mutations we see
  const pollId = setInterval(() => {
      const current = extractAllMetrics();
      if (current.download != null) {
      sawAny = true;
      lastChangeTs = Date.now();
        // Update best values
        if (metrics.download == null || current.download > metrics.download) metrics.download = current.download;
        if (current.upload != null) metrics.upload = current.upload;
        if (current.latency != null) metrics.latency = current.latency;
        if (current.jitter != null) metrics.jitter = current.jitter;
        sendUpdate(current);
    }
  }, 1000);

  // Termination conditions
  const idleCheckId = setInterval(() => {
    if (sawAny && Date.now() - lastChangeTs >= MAX_IDLE_MS) {
      cleanup();
      sendDone();
    }
  }, 1000);

  const hardStopId = setTimeout(() => {
    cleanup();
    sendDone();
  }, HARD_STOP_MS);

  function cleanup() {
    try { observer.disconnect(); } catch {}
    clearInterval(pollId);
    clearInterval(idleCheckId);
    clearTimeout(hardStopId);
  }
})();
