// fv-encoder.js - FV utils 
import * as tf from '@tensorflow/tfjs';

let gmm = null;

export async function loadGMM() {
  if (gmm) return gmm;
  const response = await fetch(chrome.runtime.getURL('assets/models/gmm_params.json'));
  const params = await response.json();
  gmm = {
    weights: tf.tensor(params.weights),
    means: tf.tensor(params.means),
    covs: tf.tensor(params.covariances)
  };
  console.log('GMM loaded');
  return gmm;
}

export function chiSquared(fv1, fv2) {
  return tf.tidy(() => fv1.sub(fv2).square().div(fv1.add(fv2).add(tf.scalar(1e-6))).sum().dataSync()[0]);
}

export function isDuplicate(fv1, fv2) {
  const dist = chiSquared(fv1, fv2);
  const score = 1 / (1 + dist);
  return { isDupe: dist < 0.8, score };
}