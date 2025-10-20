// tf-helper.js - Basic model load (used in popup if needed)
let model;

export async function loadModel() {
  if (model) return model;
  model = await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/feature_extractor/1/default/1', { fromTFHub: true });
  console.log('Model loaded');
  return model;
}