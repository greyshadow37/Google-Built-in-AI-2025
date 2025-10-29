"""
Train GMM on 20,000 CIFAR-10 images using TensorFlow MobileNetV2
"""

import argparse
import json
import os
import numpy as np
from PIL import Image

import tensorflow as tf
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.preprocessing.image import img_to_array
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from sklearn.mixture import GaussianMixture


def parse_args():
    parser = argparse.ArgumentParser(description="Train GMM on CIFAR-10 subset")
    parser.add_argument("--output_path", type=str, required=True,
                        help="Path to save gmm_params.json")
    parser.add_argument("--n_components", type=int, default=64,
                        help="Number of GMM components")
    parser.add_argument("--n_images", type=int, default=20000,
                        help="Number of images to use (max 50,000)")
    return parser.parse_args()


def load_model():
    print("[INFO] Loading MobileNetV2 (pretrained on ImageNet)...")
    # and use global average pooling to get feature vectors
    model = MobileNetV2(
        weights='imagenet',
        include_top=False,
        pooling='avg',
        input_shape=(224, 224, 3)
    )
    return model


def preprocess_image(img_np):
    """Preprocess a single image for MobileNetV2"""
    # Convert numpy array to PIL Image if needed
    if isinstance(img_np, np.ndarray):
        pil_img = Image.fromarray(img_np).convert("RGB")
    else:
        pil_img = img_np.convert("RGB")
    
    # Resize to 224x224
    pil_img = pil_img.resize((224, 224), Image.BILINEAR)
    
    # Convert to array and preprocess
    img_array = img_to_array(pil_img)
    img_array = preprocess_input(img_array)
    
    return img_array


def load_cifar10_subset(n_images=20000):
    print(f"[INFO] Loading CIFAR-10 (train) – taking {n_images} images...")
    
    # Load CIFAR-10 using TensorFlow/Keras
    (x_train, y_train), (x_test, y_test) = tf.keras.datasets.cifar10.load_data()
    
    # Take the first n_images from the training set
    n_images = min(n_images, len(x_train))
    images = x_train[:n_images]
    
    print(f"[INFO] Loaded {len(images)} CIFAR-10 images")
    return images


def extract_features(model, images, batch_size=100):
    print(f"[INFO] Extracting features from {len(images)} images...")
    features = []
    
    # Process images in batches for efficiency
    for i in range(0, len(images), batch_size):
        batch_images = images[i:i+batch_size]
        processed_batch = []
        
        for img_np in batch_images:
            try:
                processed_img = preprocess_image(img_np)
                processed_batch.append(processed_img)
            except Exception as e:
                print(f"  [WARN] Skipping image: {e}")
                continue
        
        if processed_batch:
            # Stack batch and predict
            batch_array = np.array(processed_batch)
            batch_features = model.predict(batch_array, verbose=0)
            features.append(batch_features)
        
        print(f"  [Processed] {min(i+batch_size, len(images))}/{len(images)} images...")
    
    # Concatenate all batches
    all_features = np.vstack(features).astype(np.float32)
    print(f"[INFO] Extracted features shape: {all_features.shape}")
    return all_features


def train_gmm(features, n_components):
    print(f"[INFO] Training GMM ({n_components} components) on {len(features)} samples...")
    gmm = GaussianMixture(
        n_components=n_components,
        covariance_type='diag',
        random_state=42,
        verbose=2,
        max_iter=100
    )
    gmm.fit(features)
    print("[INFO] GMM training complete.")
    return gmm


def save_gmm(gmm, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    params = {
        "weights": gmm.weights_.tolist(),
        "means": gmm.means_.tolist(),
        "covariances": gmm.covariances_.tolist()
    }
    with open(path, "w") as f:
        json.dump(params, f, indent=4)
    print(f"[INFO] GMM saved → {path}")


def main():
    args = parse_args()
    
    # Check for GPU availability
    gpus = tf.config.list_physical_devices('GPU')
    if gpus:
        print(f"[INFO] Using GPU: {len(gpus)} device(s) available")
        # Enable memory growth to avoid allocating all GPU memory at once
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)
    else:
        print("[INFO] Using CPU")

    model = load_model()
    images = load_cifar10_subset(n_images=args.n_images)
    features = extract_features(model, images)
    gmm = train_gmm(features, args.n_components)
    save_gmm(gmm, args.output_path)


if __name__ == "__main__":
    main()