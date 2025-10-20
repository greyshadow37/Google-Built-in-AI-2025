// background.js - MV3 Service Worker - Crash-proof version
// No TFJS here; keep SW light and CSP-friendly
let ENCODER_WORKER = null;
const encodingQueue = new Map();
let workerIdCounter = 0;

// Initialize worker lazily
function getWorker() {
  if (!ENCODER_WORKER) {
    try {
      ENCODER_WORKER = new Worker(chrome.runtime.getURL('js/worker.js'));
      
      // Worker handler
      ENCODER_WORKER.onmessage = (event) => {
        const { id, fv, error } = event.data;
        const queueItem = encodingQueue.get(id);
        if (queueItem) {
          const { resolve, reject } = queueItem;
          encodingQueue.delete(id);
          if (error) {
            reject(new Error(error));
          } else {
            resolve(fv);  // Raw array—tensor in background
          }
        }
      };

      ENCODER_WORKER.onerror = (error) => {
        console.error('Worker error:', error);
        // Clean up any pending requests
        for (const [id, { reject }] of encodingQueue) {
          reject(new Error('Worker crashed'));
        }
        encodingQueue.clear();
        ENCODER_WORKER = null;
      };
    } catch (error) {
      console.error('Failed to create worker:', error);
      return null;
    }
  }
  return ENCODER_WORKER;
}

// Send to worker with error handling
function sendToWorker(dataUrl) {
  const worker = getWorker();
  if (!worker) {
    return Promise.reject(new Error('Worker not available'));
  }

  const id = workerIdCounter++;
  return new Promise((resolve, reject) => {
    encodingQueue.set(id, { resolve, reject });
    
    // Timeout to prevent hanging
    const timeout = setTimeout(() => {
      encodingQueue.delete(id);
      reject(new Error('Worker timeout'));
    }, 30000); // 30 second timeout
    
    try {
      worker.postMessage({ type: 'encode', dataUrl, id });
    } catch (error) {
      clearTimeout(timeout);
      encodingQueue.delete(id);
      reject(error);
    }
  });
}

// Chi-squared distance on plain arrays to avoid TFJS in SW
function chiSquared(fv1, fv2) {
  if (!Array.isArray(fv1) || !Array.isArray(fv2) || fv1.length !== fv2.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < fv1.length; i++) {
    const a = fv1[i];
    const b = fv2[i];
    const denom = a + b + 1e-6;
    const diff = a - b;
    sum += (diff * diff) / denom;
  }
  return sum;
}

// Is duplicate check with plain arrays
function isDuplicate(fv1, fv2) {
  const dist = chiSquared(fv1, fv2);
  const score = 1 / (1 + dist);
  return { isDupe: dist < 0.8, score };
}

// Scan tabs with proper error handling
async function scanTabs() {
  try {
    // No TFJS load in service worker (kept light)

    // Get tabs with error handling
    const tabs = await new Promise((resolve, reject) => {
      chrome.tabs.query({ currentWindow: true }, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });

    if (!tabs || tabs.length === 0) {
      return [];
    }

    // Process tabs with proper error handling
    const promises = tabs.map(async (tab) => {
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 }, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(result);
            }
          });
        });

        const fv = await sendToWorker(dataUrl);
        return { tabId: tab.id, url: tab.url, title: tab.title, fv };
      } catch (error) {
        console.warn(`Failed to process tab ${tab.id}:`, error);
        return null;
      }
    });

    const images = (await Promise.all(promises)).filter(img => img !== null);
    
    if (images.length < 2) {
      return [];
    }

    // Compare images with error handling
    const matches = [];
    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        try {
          const { isDupe, score } = isDuplicate(images[i].fv, images[j].fv);
          if (isDupe) {
            matches.push({ 
              sourceTab: { id: images[i].tabId, url: images[i].url, title: images[i].title },
              targetTab: { id: images[j].tabId, url: images[j].url, title: images[j].title },
              score 
            });
          }
        } catch (error) {
          console.warn(`Failed to compare images ${i} and ${j}:`, error);
          // Continue with other comparisons
        }
      }
    }
    
    return matches;
  } catch (error) {
    console.error('Scan tabs error:', error);
    throw error;
  }
}

// Message listener with proper error handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try { console.log('Message received:', request && request.type); } catch (_) {}
  if (request.type === 'scan') {
    scanTabs()
      .then(matches => {
        try { console.log('Sending response:', 'ok'); } catch (_) {}
        sendResponse({ matches });
      })
      .catch(error => {
        console.error('Scan error:', error);
        try { console.log('Sending response:', 'error'); } catch (_) {}
        sendResponse({ error: error.message || 'Unknown error occurred' });
      });
    return true; // Keep message channel open for async response
  }
});

// Keep-alive with error handling
try {
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
      console.log('SW pinged');
    }
  });
} catch (error) {
  console.error('Failed to set up keep-alive:', error);
}

// Service worker lifecycle events
chrome.runtime.onStartup.addListener(() => {
  console.log('Service worker started');
});

chrome.runtime.onSuspend.addListener(() => {
  console.log('Service worker suspending');
  // Clean up resources
  if (ENCODER_WORKER) {
    ENCODER_WORKER.terminate();
    ENCODER_WORKER = null;
  }
  encodingQueue.clear();
});
