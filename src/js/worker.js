// worker.js - FV encoding with proper tensor management
// Load TFJS from packaged file to satisfy MV3 CSP
importScripts('js/lib/tf.min.js');

let model, gmm;
const IMAGE_SIZE = 224;
const GMM_COMPONENTS = 64;
const FEATURE_DIMS = 1280;

self.onmessage = async (e) => {
  const { type, dataUrl, id } = e.data;
  if (type === 'encode') {
    try {
      // Load model
      if (!model) {
        model = await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/feature_extractor/1/default/1', { fromTFHub: true });
      }

      // Load GMM
      if (!gmm) {
        const res = await fetch(chrome.runtime.getURL('assets/models/gmm_params.json'));
        if (!res.ok) throw new Error('GMM fetch failed');
        const params = await res.json();
        
        // Ensure proper shapes for GMM parameters
        // weights: [64], means: [64, 1280], covariances: [64, 1280]
        gmm = {
          weights: tf.tensor(params.weights, [GMM_COMPONENTS]),
          means: tf.tensor(params.means, [GMM_COMPONENTS, FEATURE_DIMS]),
          covs: tf.tensor(params.covariances, [GMM_COMPONENTS, FEATURE_DIMS])
        };
      }

      // Process image & compute FV
      const fvArray = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          // Wrap ALL tensor operations in tidy() for automatic cleanup
          const result = tf.tidy(() => {
            try {
              // Image preprocessing
              const tensor = tf.browser.fromPixels(img)
                .resizeNearestNeighbor([IMAGE_SIZE, IMAGE_SIZE])
                .toFloat()
                .div(255.0)
                .expandDims(0); // Add batch dimension
              
              // Extract features
              const features = model.predict(tensor);
              
              // Ensure features have correct shape [1, 1280]
              let X = features.squeeze(); // Remove batch dimension -> [1280]
              
              // Ensure X has correct shape for broadcasting
              if (X.shape.length === 1) {
                X = X.expandDims(0); // [1, 1280] for broadcasting with GMM
              }
              
              const { weights: w, means: mu, covs: sigma } = gmm;
              
              // Broadcasting: X [1, 1280] - mu [64, 1280] = diff [64, 1280]
              const diff = X.sub(mu); // [64, 1280]
              
              // Compute log probabilities
              const logSigma = sigma.log(); // [64, 1280]
              const term1 = logSigma.sum(1); // [64] - sum over feature dims
              const term2 = diff.pow(2).div(sigma).sum(1); // [64] - sum over feature dims
              const logProbs = w.log().sub(term1.add(term2).mul(0.5)); // [64]
              
              // Compute gamma (responsibilities) with numerical stability
              const logProbsMax = logProbs.max();
              const logProbsShifted = logProbs.sub(logProbsMax);
              const expLogProbs = logProbsShifted.exp();
              const gamma = expLogProbs.div(expLogProbs.sum()); // [64]
              
              // Compute Fisher Vector components
              // gMu computation
              const Pi_sqrt_inv = w.sqrt().reciprocal().expandDims(1); // [64, 1]
              const Gamma_expand = gamma.expandDims(1); // [64, 1]
              const sum_term_mu = diff.div(sigma); // [64, 1280]
              const gMu = Gamma_expand.mul(sum_term_mu).mul(Pi_sqrt_inv).sum(0); // [1280]
              
              // gSigma computation
              const Pi_sqrt_2_inv = w.mul(2).sqrt().reciprocal().expandDims(1); // [64, 1]
              const sum_term_sigma = sum_term_mu.mul(diff).sub(1); // [64, 1280]
              const gSigma = Gamma_expand.mul(sum_term_sigma.mul(0.5)).mul(Pi_sqrt_2_inv).sum(0); // [1280]
              
              // Concatenate and normalize Fisher Vector
              let fv = tf.concat([gMu, gSigma], 0); // [2560]
              
              // Power normalization (signed square root)
              fv = fv.pow(tf.scalar(0.5)).mul(fv.sign());
              
              // L2 normalization
              const fvNorm = fv.norm();
              fv = fv.div(fvNorm.add(tf.scalar(1e-8))); // Add small epsilon for numerical stability
              
              // Extract final array
              return fv.dataSync();
            } catch (err) {
              throw err;
            }
          });
          
          resolve(result);
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = dataUrl;
      });

      self.postMessage({ id, fv: fvArray });
    } catch (err) {
      console.error('Worker encoding error:', err);
      self.postMessage({ id, error: err.message });
    }
  }
};
