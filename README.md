# FV Duplicate Checker

A Chrome Extension prototype for detecting duplicate images across tabs using Fisher Vector (FV) encoding. It scans tab screenshots with TensorFlow.js (MobileNetV2 features + 64-component GMM), computes similarity via chi-squared distance, and uses Chrome's Prompt API for explanations. Built for the Google Chrome Built-in AI Challenge 2025—inspired by Dr. Alexy Bhowmick's work on FhVLAD and CNN-FV.


## Features
- **Tab Scanning**: Captures and crops screenshots (removes UI noise).
- **FV Encoding**: Offline FV computation in a Web Worker for privacy.
- **Duplicate Detection**: Flags ~80%+ matches with scores.
- **AI Explanations**: Prompt API generates insights (e.g., "Similar shapes/colors").
- **Simple UI**: Popup with progress, results, and "Close duplicate" button.

## Quick Start
1. **Train GMM** (once, ~5 mins):
   ```
   cd gmm_training
   pip install -r requirements.txt
   python train_gmm.py --output_path ../src/assets/models/gmm_params.json --n_components 64
   ```
   - Uses CIFAR-10 subset (20k images) for ~80% web accuracy.

2. **Load Extension**:
   - Chrome → `chrome://extensions/` → Enable Developer Mode.
   - "Load unpacked" → Select `src/` folder.
   - Pin the icon in toolbar.

3. **Test**:
   - Open 2 tabs with similar images (e.g., duplicate news photos).
   - Click extension icon → "Scan Tabs" → See matches with scores/AI.

## How It Works
1. **Capture**: `chrome.tabs.captureVisibleTab` grabs tab screenshot, cropped to content (canvas removes address bar/scrollbars).
2. **FV Encoding**: Worker.js uses tfjs MobileNetV2 for 1280-dim features, loads GMM from params.json, computes FV gradients (2560-dim vector).
3. **Detection**: `background.js` computes chi-squared distance <2.0 for dupes (score = 1/(1+dist)).
4. **AI**: `ai-helper.js` calls Prompt API for explanations (fallback for errors).
5. **UI**: `popup.js` handles async scan, progress, results with "Close" buttons.

## Setup
### Training (Optional)
- Edit `train_gmm.py` for dataset (default CIFAR-10).
- Run as above—outputs `gmm_params.json` (164k lines: weights [64], means/covars [64x1280]).
- For better generalization: Change to `tfds.load('coco', split='train', take=20000)` in script.

### Extension
- No build needed—MV3-ready.
- Dependencies: tfjs, ml-matrix, numericjs (npm install in root).
- Run in incognito for clean test (enable extension there).

## Troubleshooting
- **No Duplicates**: Lower threshold in `background.js` (dist <3.0). Test with identical images.
- **Load Error**: Ensure `gmm_params.json` in `src/assets/models/`.
- **tfjs Fail**: First scan downloads ~4MB model—needs internet.
- **UI Noise**: Cropping is basic; v2: AI content detection.

## Acknowledgments
- CIFAR-10 dataset.
- TensorFlow.js MobileNetV2.
- scikit-learn GaussianMixture.
- Inspired by Dr. Alexy Bhowmick's [FhVLAD papers](https://link.springer.com/article/10.1007/s11042-020-10491-7) and [repos](https://github.com/lx-git/CNN-FV).

## License
MIT License—feel free to fork and improve.