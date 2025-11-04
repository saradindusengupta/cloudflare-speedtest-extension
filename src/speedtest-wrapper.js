/**
 * Cloudflare Speedtest Wrapper
 * Wraps the @cloudflare/speedtest module for use in Chrome extension service worker
 */

// Import the Cloudflare speedtest module (will be bundled by rollup)
import SpeedTest from '@cloudflare/speedtest';

/**
 * Create and configure a Cloudflare speedtest instance
 * @param {Object} options - Configuration options
 * @param {Function} options.onProgress - Progress callback (download, upload, latency, jitter, progress%)
 * @param {Function} options.onComplete - Completion callback (results summary)
 * @param {Function} options.onError - Error callback
 * @returns {Object} - Control interface with start(), pause(), restart() methods
 */
function createSpeedTest({ onProgress, onComplete, onError }) {
  let engine = null;
  let isRunning = false;
  let startTime = null;
  const ESTIMATED_DURATION_MS = 30000; // 30 seconds estimated

  // Custom measurement sequence - optimized for speed and completeness
  // Skip packet loss to avoid TURN server requirement
  const measurements = [
    { type: 'latency', numPackets: 1 },  // Quick initial estimate
    { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true },  // Initial download estimate
    { type: 'latency', numPackets: 20 },  // Full latency measurement
    { type: 'download', bytes: 1e5, count: 9 },
    { type: 'download', bytes: 1e6, count: 8 },
    { type: 'upload', bytes: 1e5, count: 8 },
    { type: 'upload', bytes: 1e6, count: 6 },
    { type: 'download', bytes: 1e7, count: 6 },
    { type: 'upload', bytes: 1e7, count: 4 },
    { type: 'download', bytes: 2.5e7, count: 4 }
  ];

  const config = {
    autoStart: false,
    measurements,
    measureDownloadLoadedLatency: true,
    measureUploadLoadedLatency: true,
    loadedLatencyThrottle: 400,
    bandwidthFinishRequestDuration: 1000
  };

  function start() {
    if (isRunning) {
      return { ok: false, reason: 'already-running' };
    }

    try {
      startTime = Date.now();
      engine = new SpeedTest(config);

      // Track running state
      engine.onRunningChange = (running) => {
        isRunning = running;
      };

      // Progress updates
      engine.onResultsChange = ({ type }) => {
        if (!engine || !engine.results) return;

        const summary = engine.results.getSummary();
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / ESTIMATED_DURATION_MS) * 100);

        // Convert bps to Mbps (Cloudflare returns bits per second)
        const download = summary.download ? summary.download / 1e6 : null;
        const upload = summary.upload ? summary.upload / 1e6 : null;
        const latency = summary.latency || null;
        const jitter = summary.jitter || null;

        if (onProgress) {
          onProgress({
            download,
            upload,
            latency,
            jitter,
            progress: Math.round(progress),
            phase: type,
            timestamp: Date.now()
          });
        }
      };

      // Final results
      engine.onFinish = (results) => {
        const summary = results.getSummary();

        // Convert bps to Mbps
        const finalResults = {
          download: summary.download ? summary.download / 1e6 : null,
          upload: summary.upload ? summary.upload / 1e6 : null,
          latency: summary.latency || null,
          jitter: summary.jitter || null,
          downLoadedLatency: summary.downLoadedLatency || null,
          upLoadedLatency: summary.upLoadedLatency || null,
          timestamp: Date.now()
        };

        isRunning = false;

        if (onComplete) {
          onComplete(finalResults);
        }
      };

      // Error handling
      engine.onError = (error) => {
        isRunning = false;
        if (onError) {
          onError(error);
        }
      };

      // Start the test
      engine.play();

      return { ok: true };
    } catch (error) {
      isRunning = false;
      if (onError) {
        onError(error.message || 'Failed to start speed test');
      }
      return { ok: false, reason: error.message };
    }
  }

  function pause() {
    if (engine && isRunning) {
      engine.pause();
      isRunning = false;
      return { ok: true };
    }
    return { ok: false, reason: 'not-running' };
  }

  function restart() {
    if (engine) {
      startTime = Date.now();
      engine.restart();
      return { ok: true };
    }
    return start();
  }

  function getStatus() {
    return {
      isRunning,
      hasEngine: !!engine
    };
  }

  return {
    start,
    pause,
    restart,
    getStatus
  };
}

// Attach to global scope for service worker compatibility
if (typeof self !== 'undefined') {
  self.CloudflareSpeedtest = { createSpeedTest };
}