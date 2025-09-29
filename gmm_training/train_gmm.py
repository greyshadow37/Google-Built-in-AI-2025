"""
Offline tool to extract deep features using a pretrained MobileNetV2 backbone
and train a Gaussian Mixture Model (GMM) for Fisher Vector style encoding.

Usage:
    python train_gmm.py --dataset_path /path/to/images --output_path ./gmm_params.json --n_components 64
"""

import os
import sys
import glob
import json
import argparse
from typing import List

import numpy as np
from PIL import Image

import torch
import torch.nn as nn
from torchvision import models, transforms
from sklearn.mixture import GaussianMixture


def parse_args():
    parser = argparse.ArgumentParser(description="Train a GMM on MobileNetV2 feature embeddings.")
    parser.add_argument("--dataset_path", type=str, required=True,
                        help="Path to directory containing training images (jpg/png).")
    parser.add_argument("--output_path", type=str, required=True,
                        help="Path to output gmm_params.json file.")
    parser.add_argument("--n_components", type=int, default=64,
                        help="Number of Gaussian components for the GMM (default: 64).")
    return parser.parse_args()


def load_feature_extractor(device: torch.device) -> nn.Module:
    print("[INFO] Loading MobileNetV2 backbone (pretrained)...")
    model = models.mobilenet_v2(weights='DEFAULT')
    model.classifier = nn.Identity()
    model.to(device)
    model.eval()
    print("[INFO] Model ready. Feature dimension: 1280")
    return model


def build_transforms():
    return transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225]
        )
    ])


def collect_image_paths(dataset_path: str) -> List[str]:
    patterns = ["**/*.jpg", "**/*.jpeg", "**/*.png", "*.jpg", "*.jpeg", "*.png"]
    image_paths = []
    for p in patterns:
        image_paths.extend(glob.glob(os.path.join(dataset_path, p), recursive=True))
    # Deduplicate while preserving order
    seen = set()
    unique_paths = []
    for path in image_paths:
        norm = os.path.normpath(path)
        if norm not in seen:
            seen.add(norm)
            unique_paths.append(norm)
    return unique_paths


def extract_features(model: nn.Module,
                     device: torch.device,
                     image_paths: List[str],
                     tfm: transforms.Compose) -> np.ndarray:
    features = []
    total = len(image_paths)
    if total == 0:
        raise RuntimeError("No images found. Supported extensions: .jpg, .jpeg, .png")

    print(f"[INFO] Beginning feature extraction for {total} images...")
    with torch.no_grad():
        for idx, img_path in enumerate(image_paths, start=1):
            print(f"[INFO] Processing image {idx} of {total}: {img_path}")
            try:
                with Image.open(img_path).convert("RGB") as img:
                    tensor = tfm(img).unsqueeze(0).to(device)
                    out = model(tensor)
                    # Ensure tensor shape (1, 1280)
                    out_cpu = out.squeeze(0).detach().cpu().numpy()
                    features.append(out_cpu)
            except Exception as e:
                print(f"[WARN] Failed to process {img_path}: {e}", file=sys.stderr)
                continue

    if not features:
        raise RuntimeError("No features extracted. All image loads may have failed.")

    feature_matrix = np.vstack(features).astype(np.float32)
    print(f"[INFO] Feature extraction complete. Shape: {feature_matrix.shape}")
    return feature_matrix


def train_gmm(features: np.ndarray, n_components: int) -> GaussianMixture:
    print(f"[INFO] Training GMM with {n_components} components on {features.shape[0]} samples...")
    gmm = GaussianMixture(
        n_components=n_components,
        covariance_type='diag',
        verbose=2,
        random_state=42
    )
    gmm.fit(features)
    print("[INFO] GMM training complete.")
    return gmm


def export_gmm(gmm: GaussianMixture, output_path: str):
    params = {
        "weights": gmm.weights_.tolist(),
        "means": gmm.means_.tolist(),
        "covariances": gmm.covariances_.tolist()
    }

    out_dir = os.path.dirname(os.path.abspath(output_path))
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(params, f, indent=4)

    print(f"[INFO] GMM parameters exported to: {output_path}")


def main():
    args = parse_args()

    dataset_path = args.dataset_path
    output_path = args.output_path
    n_components = args.n_components

    if not os.path.isdir(dataset_path):
        print(f"[ERROR] Dataset path does not exist or is not a directory: {dataset_path}", file=sys.stderr)
        sys.exit(1)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[INFO] Using device: {device}")

    model = load_feature_extractor(device)
    tfm = build_transforms()
    image_paths = collect_image_paths(dataset_path)

    try:
        features = extract_features(model, device, image_paths, tfm)
    except Exception as e:
        print(f"[ERROR] Feature extraction failed: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        gmm = train_gmm(features, n_components)
    except Exception as e:
        print(f"[ERROR] GMM training failed: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        export_gmm(gmm, output_path)
    except Exception as e:
        print(f"[ERROR] Export failed: {e}", file=sys.stderr)
        sys.exit(1)

    print("[INFO] All done.")


if __name__ == "__main__":
    main()