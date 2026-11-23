# YuNet face detection model

`face_detection_yunet_2023mar.onnx` is the YuNet face detector from the
OpenCV model zoo. At stitch time it looks at the first few seconds of the
stitched video so the hook line can sit above Rav Eli's head when there is
room in the reel safe zone, or in the lower-middle safe zone when the face
is too high (as on tight Vayishlach close-ups).

- Source: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- License: Apache License 2.0 (OpenCV zoo)
- No runtime download: the file is bundled here and shipped with the Modal
  image via `add_local_dir("references")`.
