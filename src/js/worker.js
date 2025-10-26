// Dynamic TFJS loading on-demand
let tfLoaded = false;
let model;
let gmm;
const IMAGE_SIZE = 224;

self.onmessage = async (e) => {
    const { type, dataUrl, id } = e.data;
    if (type === 'encode') {
        try {
            // Load TFJS on-demand if not loaded
            if (!tfLoaded) {
                const response = await fetch('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.13.0/dist/tf.min.js');
                const code = await response.text();
                eval(code);
                tfLoaded = true;
                console.log('tfjs loaded in worker');
            }

            // Load Model
            if (!model) {
                model = await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/feature_extractor/1/default/1', { fromTFHub: true });
            }

            // Load GMM
            if (!gmm) {
                const res = await fetch('/assets/models/gmm_params.json');
                if (!res.ok) throw new Error("GMM load failed.");
                const params = await res.json();
                gmm = {
                    weights: tf.tensor(params.weights),
                    means: tf.tensor(params.means),
                    covs: tf.tensor(params.covariances)
                };
            }

            // Image Processing and FV Encoding
            const fvArray = await new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous'; 
                
                img.onload = () => {
                    tf.tidy(() => {
                        try {
                            // Extract Features 
                            const tensor = tf.browser.fromPixels(img).toFloat().div(255.0);
                            const resized = tf.image.resizeBilinear(tensor, [IMAGE_SIZE, IMAGE_SIZE]);
                            const batched = resized.expandDims(0); 
                            
                            const features = model.predict(batched);
                            tf.dispose(tensor);
                            tf.dispose(resized);
                            tf.dispose(batched);
                            
                            // Compute FV 
                            const X = features.squeeze();
                            const { weights: w, means: mu, covs: sigma } = gmm;
                            
                            // Calculate Soft Assignments 
                            const diff = X.sub(mu);
                            const logSigma = sigma.log();
                            const term1 = logSigma.sum(1);
                            const term2 = diff.square().div(sigma).sum(1);
                            const logProbs = w.log().sub(term1.add(term2).mul(0.5));
                            const gamma = logProbs.sub(logProbs.max()).exp().div(logProbs.exp().sum());

                            // Calculate Gradients G_mu and G_sigma
                            const Pi_sqrt_inv = w.sqrt().reciprocal().unsqueeze(1);
                            const Gamma_expand = gamma.unsqueeze(1);
                            const sum_term_mu = diff.div(sigma); 
                            const gMu = Gamma_expand.mul(sum_term_mu).mul(Pi_sqrt_inv).sum(0);

                            const Pi_sqrt_2_inv = w.mul(2).sqrt().reciprocal().unsqueeze(1);
                            const sum_term_sigma = sum_term_mu.mul(diff).sub(1);
                            const gSigma = Gamma_expand.mul(sum_term_sigma.mul(0.5)).mul(Pi_sqrt_2_inv).sum(0);
                            
                            let fv = tf.concat([gMu, gSigma], 0); 
                            
                            fv = fv.pow(tf.scalar(0.5)).mul(fv.sign()); 
                            
                            const fvNorm = fv.norm();
                            fv = fv.div(fvNorm.add(tf.scalar(1e-8)));
                            
                            const fvArray = fv.dataSync();
                            tf.dispose(features);
                            resolve(fvArray);
                        } catch (tidyErr) {
                            reject(tidyErr);
                        }
                    });
                };
                img.onerror = () => reject(new Error(`Worker: Image load failed from dataUrl.`));
                img.src = dataUrl;
            });

            //  Send Success Result
            self.postMessage({ id, fv: fvArray }, [fvArray.buffer]); // Transferable ArrayBuffer

        } catch (err) {
            //  Send Error Result
            self.postMessage({ id, error: err.message });
        }
    }
};