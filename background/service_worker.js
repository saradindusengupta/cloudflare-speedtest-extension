// Background service worker for fastdotcom-extension (MV3)
// Uses Cloudflare's official speedtest module for measurements
// https://github.com/cloudflare/speedtest

// Define window as self for compatibility with the speedtest bundle
// The bundle uses window.location.origin but service workers only have self
if (typeof window === 'undefined') {
  self.window = self;
  // Provide location.origin for the bundle
  self.window.location = { origin: 'https://speed.cloudflare.com' };
}

// Import the bundled Cloudflare speedtest wrapper using an absolute extension URL
// This avoids any ambiguity about relative paths from the background/ folder
try {
  importScripts(chrome.runtime.getURL('dist/speedtest-bundle.js'));
} catch (e) {
  // Fallback: attempt relative imports if chrome.runtime isn't available (e.g., during local tests)
  try { importScripts('../dist/speedtest-bundle.js'); }
  catch (_) { importScripts('dist/speedtest-bundle.js'); }
}

const STATE = {
  testRunning: false,
  lastResult: null,
  currentTest: null,
  retryCount: 0,
  maxRetries: 3,
  backoffDelay: 1000 // Start with 1 second
};

chrome.runtime.onInstalled.addListener((details) => {
  console.log('fastdotcom-extension installed:', details.reason);
  
  // Clean up old settings from previous version
  if (details.reason === 'update') {
    chrome.storage.local.remove(['testMode'], () => {
      console.log('Removed legacy testMode setting');
    });
  }
});

// Persist successful test results to chrome.storage.local
function persistResult(result) {
  // Store only valid results with numeric values
  const { download, upload, latency, jitter } = result;
  if (typeof download !== 'number' || !Number.isFinite(download)) {
    console.warn('Invalid result data, skipping persistence:', result);
    return;
  }

  const entry = { 
    ts: Date.now(), 
    download,
    upload: upload ?? null,
    latency: latency ?? null,
    jitter: jitter ?? null,
    units: 'Mbps'
  };

  chrome.storage.local.get(['results'], (data) => {
    if (chrome.runtime.lastError) {
      console.error('Storage read error:', chrome.runtime.lastError);
      return;
    }
    
    // Validate existing data structure
    let prev = [];
    try {
      if (Array.isArray(data?.results)) {
        // Validate each entry
        prev = data.results.filter(item => 
          item && 
          typeof item === 'object' &&
          typeof item.download === 'number' &&
          Number.isFinite(item.download)
        );
      }
    } catch (e) {
      console.error('Invalid stored data, resetting:', e);
      prev = [];
    }
    
    const next = [entry, ...prev].slice(0, 2); // Keep only last two results
    chrome.storage.local.set({ results: next }, () => {
      if (chrome.runtime.lastError) {
        console.error('Storage write error:', chrome.runtime.lastError);
      }
    });
  });
}

// Categorize error types for better user messaging
function categorizeError(error) {
  const message = error?.message?.toLowerCase() || '';
  const name = error?.name?.toLowerCase() || '';
  
  // Network connectivity issues
  if (message.includes('network') || 
      message.includes('fetch') || 
      message.includes('timeout') ||
      message.includes('connection') ||
      name === 'networkerror' ||
      !navigator.onLine) {
    return { type: 'network', userMessage: 'Network connection issue. Please check your internet connection.' };
  }
  
  // Rate limiting
  if (message.includes('429') || 
      message.includes('rate limit') ||
      message.includes('too many requests')) {
    return { type: 'rate-limit', userMessage: 'Too many requests. Please wait a moment and try again.' };
  }
  
  // CORS or security issues
  if (message.includes('cors') || 
      message.includes('blocked') ||
      message.includes('security')) {
    return { type: 'security', userMessage: 'Connection blocked. Please check your browser settings.' };
  }
  
  // Generic error
  return { type: 'unknown', userMessage: 'Test failed. Please try again.' };
}

// Start Cloudflare speed test with retry logic
function startCloudflareSpeedTest() {
  if (STATE.testRunning) return;
  
  // Check network connectivity first
  if (!navigator.onLine) {
    chrome.runtime.sendMessage({
      type: 'FAST_SPEED_DONE',
      ok: false,
      reason: 'offline',
      userMessage: 'No internet connection detected. Please check your connection.'
    });
    return;
  }
  
  STATE.testRunning = true;
  chrome.runtime.sendMessage({ type: 'FAST_SPEED_STATUS', status: 'starting' });

  const speedTest = CloudflareSpeedtest.createSpeedTest({
    onProgress: (data) => {
      // Forward progress updates to popup
      chrome.runtime.sendMessage({ 
        type: 'FAST_SPEED_UPDATE',
        download: data.download ?? null,
        upload: data.upload ?? null,
        latency: data.latency ?? null,
        jitter: data.jitter ?? null,
        units: 'Mbps',
        progress: data.progress ?? 0,
        phase: data.phase ?? 'unknown',
        ts: Date.now()
      });
    },
    onComplete: (result) => {
      STATE.testRunning = false;
      STATE.currentTest = null;
      STATE.retryCount = 0; // Reset retry count on success
      STATE.lastResult = {
        download: result.download ?? null,
        upload: result.upload ?? null,
        latency: result.latency ?? null,
        jitter: result.jitter ?? null,
        units: 'Mbps',
        ts: Date.now()
      };

      // Notify popup of completion
      chrome.runtime.sendMessage({
        type: 'FAST_SPEED_DONE',
        ok: true,
        download: result.download ?? null,
        upload: result.upload ?? null,
        latency: result.latency ?? null,
        jitter: result.jitter ?? null,
        units: 'Mbps'
      });

      // Persist result
      persistResult(result);
    },
    onError: (error) => {
      STATE.testRunning = false;
      STATE.currentTest = null;
      
      console.error('Speed test failed:', error);
      
      const errorInfo = categorizeError(error);
      
      // Implement exponential backoff retry for transient errors
      if ((errorInfo.type === 'network' || errorInfo.type === 'rate-limit') && 
          STATE.retryCount < STATE.maxRetries) {
        STATE.retryCount++;
        const delay = STATE.backoffDelay * Math.pow(2, STATE.retryCount - 1);
        
        console.log(`Retrying test in ${delay}ms (attempt ${STATE.retryCount}/${STATE.maxRetries})`);
        
        chrome.runtime.sendMessage({
          type: 'FAST_SPEED_STATUS',
          status: `Retrying in ${Math.ceil(delay / 1000)}s...`
        });
        
        setTimeout(() => {
          startCloudflareSpeedTest();
        }, delay);
      } else {
        // Max retries reached or non-retryable error
        STATE.retryCount = 0;
        
        chrome.runtime.sendMessage({
          type: 'FAST_SPEED_DONE',
          ok: false,
          reason: errorInfo.type,
          userMessage: errorInfo.userMessage
        });
      }
    }
  });

  STATE.currentTest = speedTest;
  
  try {
    speedTest.start();
  } catch (e) {
    console.error('Failed to start test:', e);
    STATE.testRunning = false;
    STATE.currentTest = null;
    
    const errorInfo = categorizeError(e);
    chrome.runtime.sendMessage({
      type: 'FAST_SPEED_DONE',
      ok: false,
      reason: errorInfo.type,
      userMessage: errorInfo.userMessage
    });
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'START_TEST': {
      if (STATE.testRunning) {
        sendResponse({ ok: false, reason: 'already-running' });
        return;
      }
      
      startCloudflareSpeedTest();
      sendResponse({ ok: true });
      break;
    }

    case 'GET_TEST_STATE': {
      sendResponse({ 
        running: STATE.testRunning, 
        lastResult: STATE.lastResult 
      });
      break;
    }

    default:
      break;
  }

  return false;
});
