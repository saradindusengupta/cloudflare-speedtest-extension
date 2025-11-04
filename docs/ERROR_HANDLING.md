# Error Handling Strategy

This document outlines the comprehensive error handling strategy implemented in the extension.

## Overview

The extension implements robust error handling for common failure scenarios including:
- Network connectivity issues
- Rate limiting responses
- Invalid or corrupted stored data
- Browser compatibility issues

## Error Categories

### 1. Network Connectivity Issues

#### Detection
- Check `navigator.onLine` status before test initiation
- Monitor `online` and `offline` events
- Catch network-related exceptions (NetworkError, fetch failures, timeouts)
- Implement 5-second timeout for IP address fetch

#### Handling
- **Prevention**: Check online status before starting tests
- **User Feedback**: Display "No internet connection detected" message
- **Recovery**: Automatically retry with exponential backoff (max 3 retries)
- **Monitoring**: Listen for network status changes and notify user when connection is restored

#### Implementation
```javascript
// service_worker.js
if (!navigator.onLine) {
  chrome.runtime.sendMessage({
    type: 'FAST_SPEED_DONE',
    ok: false,
    reason: 'offline',
    userMessage: 'No internet connection detected. Please check your connection.'
  });
  return;
}
```

### 2. Rate Limiting

#### Detection
- Look for HTTP 429 status codes
- Check error messages for "rate limit" or "too many requests"
- Categorize in `categorizeError()` function

#### Handling
- **Retry Strategy**: Exponential backoff with base delay of 1 second
- **Max Retries**: 3 attempts before giving up
- **User Feedback**: "Too many requests. Please wait a moment and try again."
- **Backoff Formula**: `delay = baseDelay * 2^(retryCount - 1)`

#### Implementation
```javascript
// Retry delays: 1s, 2s, 4s
if (errorInfo.type === 'rate-limit' && STATE.retryCount < STATE.maxRetries) {
  STATE.retryCount++;
  const delay = STATE.backoffDelay * Math.pow(2, STATE.retryCount - 1);
  setTimeout(() => startCloudflareSpeedTest(), delay);
}
```

### 3. Invalid or Corrupted Stored Data

#### Detection
- Validate data structure before use
- Check for required fields and types
- Filter out invalid entries
- Use try-catch blocks around storage operations

#### Handling
- **Validation**: Filter results to ensure valid numeric values
- **Sanitization**: Remove corrupted entries automatically
- **Recovery**: Reset to empty array if data is completely corrupted
- **Logging**: Console warnings for debugging

#### Implementation
```javascript
// Validate stored results
results = data.results.filter(item => 
  item && 
  typeof item === 'object' &&
  typeof item.download === 'number' &&
  Number.isFinite(item.download)
);

// Clean up if data was corrupted
if (results.length !== data.results.length) {
  chrome.storage.local.set({ results });
}
```

### 4. Browser Compatibility Issues

#### Detection
- Check for required Chrome extension APIs on startup
- Validate existence of:
  - `chrome` object
  - `chrome.runtime`
  - `chrome.storage.local`
  - `chrome.runtime.sendMessage`

#### Handling
- **Early Detection**: Check APIs before initialization
- **User Feedback**: Display clear error message if APIs missing
- **Graceful Degradation**: Block execution rather than fail mysteriously

#### Implementation
```javascript
const hasRequiredAPIs = () => {
  const required = {
    chrome: typeof chrome !== 'undefined',
    runtime: typeof chrome?.runtime !== 'undefined',
    storage: typeof chrome?.storage?.local !== 'undefined',
    messaging: typeof chrome?.runtime?.sendMessage === 'function'
  };
  
  const missing = Object.entries(required)
    .filter(([_, exists]) => !exists)
    .map(([api]) => api);
  
  if (missing.length > 0) {
    console.error('Missing required APIs:', missing);
    return false;
  }
  
  return true;
};
```

## Error Message Strategy

### Technical vs User-Facing Messages

All errors are categorized and translated to user-friendly messages:

| Error Type | Technical Reason | User Message |
|-----------|------------------|--------------|
| Network | NetworkError, timeout, offline | "Network connection issue. Please check your internet connection." |
| Rate Limit | HTTP 429, too many requests | "Too many requests. Please wait a moment and try again." |
| Security | CORS, blocked, security policy | "Connection blocked. Please check your browser settings." |
| Offline | navigator.onLine === false | "No internet connection detected. Please check your connection." |
| Storage | chrome.runtime.lastError | "Error loading/saving data" |
| Unknown | Generic errors | "Test failed. Please try again." |

### Implementation
```javascript
function categorizeError(error) {
  const message = error?.message?.toLowerCase() || '';
  const name = error?.name?.toLowerCase() || '';
  
  if (message.includes('network') || !navigator.onLine) {
    return { 
      type: 'network', 
      userMessage: 'Network connection issue. Please check your internet connection.' 
    };
  }
  
  if (message.includes('429') || message.includes('rate limit')) {
    return { 
      type: 'rate-limit', 
      userMessage: 'Too many requests. Please wait a moment and try again.' 
    };
  }
  
  // ... more categories
}
```

## Storage Error Handling

### Read Operations
- Always check `chrome.runtime.lastError` after storage operations
- Validate data structure before use
- Provide fallback values (empty arrays, null)
- Log errors for debugging

### Write Operations
- Check for errors in callback
- Don't assume write succeeded
- Provide user feedback on critical failures

### Example
```javascript
chrome.storage.local.get(['results'], (data) => {
  if (chrome.runtime.lastError) {
    console.error('Storage error:', chrome.runtime.lastError);
    renderHistory([]); // Fallback
    return;
  }
  
  // Validate and use data
  const results = validateResults(data.results);
  renderHistory(results);
});
```

## Retry Logic

### When to Retry
- Network errors (transient failures)
- Rate limiting (service temporarily unavailable)

### When NOT to Retry
- Security/CORS errors (won't fix with retry)
- Invalid data errors (application logic issue)
- After max retries exceeded

### Configuration
```javascript
const STATE = {
  retryCount: 0,
  maxRetries: 3,
  backoffDelay: 1000 // 1 second base delay
};
```

## Timeout Handling

### IP Address Fetch
- 5-second timeout using AbortController
- Graceful fallback to "—" display
- Disable copy button on failure

```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

const resp = await fetch(url, { signal: controller.signal });
clearTimeout(timeoutId);
```

## Network Status Monitoring

### Real-time Updates
- Listen for `online` and `offline` events
- Update UI status immediately
- Disable test button when offline
- Re-enable and reload IP when connection restored

```javascript
window.addEventListener('online', () => {
  setStatus('Connection restored');
  loadClientIp();
});

window.addEventListener('offline', () => {
  setStatus('No internet connection');
  if (running) {
    running = false;
    hideProgress();
  }
});
```

## Logging Strategy

### Console Output
- **Errors**: Always log with context
- **Warnings**: Log for non-critical issues
- **Info**: Log retry attempts and recovery

### User Feedback
- Status line updates for all state changes
- Clear, actionable error messages
- Progress indicators during retry

## Testing Error Scenarios

### Manual Testing
1. **Offline**: Disable network, try test
2. **Slow Network**: Use Chrome DevTools throttling
3. **Corrupted Data**: Manually corrupt storage via DevTools
4. **Rate Limiting**: Make rapid repeated requests
5. **Timeout**: Use very slow connection

### Expected Behavior
- No crashes or silent failures
- Clear error messages displayed
- Automatic retry where appropriate
- Data integrity maintained

## Future Enhancements

1. **Telemetry**: Track error rates for monitoring
2. **User Reporting**: Allow users to report persistent issues
3. **Circuit Breaker**: Stop retrying after consistent failures
4. **Offline Mode**: Cache last result for offline viewing
5. **Health Check**: Pre-test connectivity check to Cloudflare

## Related Files

- `background/service_worker.js` - Main error handling logic
- `popup/popup.js` - UI error handling and user feedback
- `docs/STRUCTURE.md` - Architecture overview
