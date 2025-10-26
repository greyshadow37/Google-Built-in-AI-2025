// src/js/background.js - MV3 Service Worker (Stable Dedicated Worker Model)

let ENCODER_WORKER = null; 
const encodingQueue = new Map();
let workerIdCounter = 0;

// Lazy worker initialization
function getWorker() {
    if (!ENCODER_WORKER) {
        try {
            ENCODER_WORKER = new Worker(chrome.runtime.getURL('js/worker.js'));
            
            // Worker handler: This listens to messages FROM the dedicated worker
            ENCODER_WORKER.onmessage = (event) => {
                const { id, fv, error } = event.data;
                const queueItem = encodingQueue.get(id);
                if (queueItem) {
                    const { resolve, reject, timeout } = queueItem;
                    if (timeout) clearTimeout(timeout);
                    encodingQueue.delete(id);
                    if (error) {
                        reject(new Error(error));
                    } else {
                        resolve(fv); // Raw array data
                    }
                }
            };

            ENCODER_WORKER.onerror = (error) => {
                console.error('Worker crashed:', error);
                // Clean up any pending requests
                for (const [id, item] of encodingQueue) {
                    if (item.timeout) clearTimeout(item.timeout);
                    item.reject(new Error('Worker crashed'));
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

// Send to worker with error handling and timeout
function sendToWorker(dataUrl) {
    const worker = getWorker();
    if (!worker) {
        return Promise.reject(new Error('Worker not available'));
    }

    const id = workerIdCounter++;
    return new Promise((resolve, reject) => {
        // Timeout to prevent hanging (first run is slow, 30s is fine)
        const timeout = setTimeout(() => {
            encodingQueue.delete(id);
            reject(new Error('Worker timeout'));
        }, 30000); 
        encodingQueue.set(id, { resolve, reject, timeout });
        
        try {
            // Post message to the dedicated worker instance
            worker.postMessage({ type: 'encode', dataUrl, id });
        } catch (error) {
            clearTimeout(timeout);
            encodingQueue.delete(id);
            reject(error);
        }
    });
}

// Crop image to center 224x224
function cropImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 224;
            canvas.height = 224;
            
            // Calculate center crop
            const sourceX = Math.max(0, (img.width - 224) / 2);
            const sourceY = Math.max(0, (img.height - 224) / 2);
            const sourceWidth = Math.min(224, img.width);
            const sourceHeight = Math.min(224, img.height);
            
            ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 224, 224);
            const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            console.log('Cropped image size: 224x224');
            resolve(croppedDataUrl);
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

// Inline chi-squared 
function chiSquared(fv1, fv2) {
    let sum = 0;
    for (let i = 0; i < fv1.length; i++) {
        const num = (fv1[i] - fv2[i]) ** 2;
        const den = fv1[i] + fv2[i] + 1e-6;
        sum += num / den;
    }
    return sum;
}

// Inline isDuplicate 
function isDuplicate(fv1, fv2) {
    const dist = chiSquared(fv1, fv2);
    const score = 1 / (1 + dist);
    return { isDupe: dist < 1.5 && score > 0.7, score };
}

// Scan 
async function scanTabs() {
    const tabs = await new Promise(r => chrome.tabs.query({ currentWindow: true, url: ["http://*/*", "https://*/*", "file:///*"] }, r));
    const limitedTabs = tabs.slice(0, 3); // Limit to 3 tabs for debugging
    
    const promises = limitedTabs.map(tab => 
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 })
            .then(dataUrl => cropImage(dataUrl))
            .then(croppedDataUrl => sendToWorker(croppedDataUrl).then(fv => ({ 
                tabId: tab.id, 
                url: tab.url,        
                title: tab.title,    
                fv // Raw array data from worker
            })))
            .catch(e => {
                console.warn(`Failed to process tab ${tab.id}: ${e.message}`);
                return null;
            })
    );
    const images = (await Promise.all(promises)).filter(img => img !== null);
    if (images.length < 2) return [];

    const matches = [];
    for (let i = 0; i < images.length; i++) {
        for (let j = i + 1; j < images.length; j++) {
          const { isDupe, score } = isDuplicate(images[i].fv, images[j].fv); 
          console.log(`Distance: ${chiSquared(images[i].fv, images[j].fv)}, score: ${score}`);
    
          if (isDupe) matches.push({ 
              sourceTab: { id: images[i].tabId, url: images[i].url, title: images[i].title }, 
              targetTab: { id: images[j].tabId, url: images[j].url, title: images[j].title }, 
              score: score 
          });
      }
    }
    return matches;
}

// Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'scan') {
        scanTabs().then(matches => sendResponse({ matches })).catch(e => sendResponse({ error: e.message }));
        return true;
    }
});

// Service worker lifecycle events
chrome.runtime.onStartup.addListener(() => {
    console.log('Service worker started');
});

// Keep-Alive Alarm 
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 }); 
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'keepAlive') {
        console.log('SW keepAlive ping. Worker is currently active.');
    }
});