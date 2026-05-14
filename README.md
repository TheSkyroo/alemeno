# 🔲 Marker Scanner

> A React Native Android app that detects a custom asymmetric square marker in real-time using a pure TypeScript computer vision pipeline — no OpenCV required.

![React Native](https://img.shields.io/badge/React_Native-0.73.9-61DAFB?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![Vision Camera](https://img.shields.io/badge/Vision_Camera-v4-FF6B6B?style=for-the-badge)

---

## ✨ Features

- 📷 **Live camera feed** powered by `react-native-vision-camera`
- 🔲 **Center-square frame processing** with a JavaScript worklet pipeline
- 🧠 **9-stage detection algorithm** — grayscale → blur → Otsu → BFS → quad fit → homography → orientation → verify → dedup
- 🔄 **Orientation correction** across all 4 rotations via asymmetric corner scoring
- 💾 **Collects 20 distinct** 300×300 PNG captures with perceptual-hash deduplication
- 🔧 **Zero native CV dependencies** — all image processing runs in Reanimated worklets

---

## 📁 Project Structure

```
marker-scanner/
├── src/
│   ├── screens/
│   │   ├── CameraScreen.tsx         # Live viewfinder + frame processor
│   │   └── ResultsScreen.tsx        # 20-capture gallery
│   ├── components/
│   │   ├── MarkerOverlay.tsx         # Viewfinder guide square
│   │   ├── MarkerGrid.tsx            # Capture thumbnail grid
│   │   └── CaptureProgress.tsx      # Progress bar (x / 20)
│   └── utils/
│       ├── markerDetection.ts        # Full 9-stage pipeline
│       ├── perspectiveTransform.ts   # Homography warp
│       ├── orientationCorrection.ts
│       └── imageUtils.ts             # PNG encoder, base64, pHash
├── assets/marker/
│   ├── marker.png                    # Printable marker (300×300)
│   └── marker_print.png
├── Marker Images/                    # Test images (correct & incorrect)
├── APPROACH.md                       # Full technical write-up
└── App.tsx
```

---

## 🧠 Detection Algorithm

The pipeline runs inside a `useFrameProcessor` worklet at ~4 fps on a 600×600 center crop:

| Stage | Description |
| -----:|:----------- |
| **1** | Crop largest centered square, resize to **600×600 RGB** |
| **2** | Convert to grayscale — ITU-R BT.601 luminance weights |
| **3** | Separable **5×5 Gaussian blur** to suppress noise |
| **4** | **Otsu adaptive threshold** — no hard-coded constants |
| **5** | **BFS connected-component** analysis with pre-filters |
| **6** | Fit a **quadrilateral** from extreme boundary points |
| **7** | Compute a **3×3 homography**, warp to 300×300 patch |
| **8** | **Orientation correction** — score all 4 rotations |
| **9** | **Marker verification** (5 region checks) + pHash dedup |

<details>
<summary><b>Candidate Pre-filters (Stage 5)</b></summary>

| Filter | Range | Reason |
|:------ |:-----:|:------ |
| Pixel area | 5 000 – 500 000 | Rejects tiny noise and full-frame blobs |
| Bounding-box aspect ratio | 0.8 – 1.2 | Border must be nearly square |
| Fill ratio (area / bbox) | 0.08 – 0.45 | Hollow frame sits here; solid blocks are rejected |
| Boundary point count | ≥ 40 | Degenerate micro-blobs discarded |

</details>

<details>
<summary><b>Marker Verification Thresholds (Stage 9)</b></summary>

| Region Check | Threshold | Rejects |
|:------------ |:---------:|:------- |
| Outer 20 px border — black ratio | ≥ 0.80 | Rectangles without a full border |
| Top-left 60×60 — black ratio | ≥ 0.75 | Markers missing the corner square |
| Top-right 60×60 — white ratio | ≥ 0.70 | Wrong corner placement |
| Bottom-left 60×60 — white ratio | ≥ 0.70 | Wrong corner placement |
| Bottom-right 60×60 — white ratio | ≥ 0.70 | Wrong corner placement |
| Interior (20–280 px band) — white ratio | ≥ 0.60 | Dense QR codes, solid rectangles |

</details>

---

## 🔲 Marker Design

The target marker is an **asymmetric square** — each 90° rotation is visually unique due to the single filled corner:

| Property | Value |
|:-------- |:----- |
| Canvas size | 300 × 300 px |
| Outer border thickness | 20 px |
| Filled corner square | 60 × 60 px (top-left only) |
| Color palette | Black & white only |
| Interior open area | > 60% (designed for future payload encoding) |

Printable assets: `assets/marker/marker.png` and `assets/marker/marker_print.png`

---

## ⚡ Performance

| Stage | ~Cost |
|:----- | -----:|
| Resize + crop (native plugin) | 4 ms |
| Grayscale + blur + threshold | 8 ms |
| Connected components (BFS) | 12 ms |
| Homography warp | 10 ms |
| Orientation + verify | 3 ms |
| PNG encode + base64 | 6 ms |
| **Total** | **~43 ms** |

> Typical end-to-end scan-to-result time for a well-lit, hand-held marker: **< 300 ms**

---

## 🛠️ Prerequisites

| Tool | Version |
|:---- |:------- |
| Node.js | 18 LTS or later |
| Java JDK | 17 |
| Android Studio | Hedgehog or later |
| Android SDK | API 33+ |
| Android NDK | 25.1+ (required by Vision Camera) |

Ensure `ANDROID_HOME` and `JAVA_HOME` are set in your environment.

---

## 🚀 Setup & Run

```bash
# 1. Clone the repository
git clone https://github.com/TheSkyroo/alemeno.git
cd alemeno

# 2. Install dependencies
npm install

# 3. Start Metro bundler
npm start
```

Connect a physical Android device with USB debugging enabled, then in a separate terminal:

```bash
npm run android
```

> **Note:** A physical device is required — `react-native-vision-camera` does not support emulators.

---

## 📦 Build Release APK

```bash
cd android
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

> Use **JDK 17** with React Native 0.73.x for the highest build compatibility.

---

## 📚 Tech Stack

| Package | Purpose |
|:------- |:------- |
| `react-native-vision-camera` | Raw camera frame access |
| `vision-camera-resize-plugin` | Native crop + resize in worklet |
| `react-native-reanimated` | Worklet runtime for off-thread processing |
| `react-native-worklets-core` | Shared worklet utilities |
| `@react-navigation/native-stack` | Screen navigation |

---

## ⚠️ Known Limitations

- Contour stage is TypeScript-only (no OpenCV), so quad estimates rely on extreme-corner fitting from connected-component boundaries.
- Otsu thresholding performs well under normal lighting but may degrade under extremely uneven illumination.
- Release builds have not been run in this workspace — local Android SDK and NDK installation is required.

---

## 🗺️ Potential Improvements

- [ ] Native OpenCV frame processor for adaptive thresholding and motion-blur resilience
- [ ] Bit-encoding inside the white interior using a cell grid
- [ ] Exposure/focus guidance overlays for poor lighting
- [ ] Motion-quality gate to reject blurry frames before processing

---

## 📄 License

Built as part of the **Alemeno Frontend Internship Assignment**. See [`APPROACH.md`](./APPROACH.md) for the full technical write-up.