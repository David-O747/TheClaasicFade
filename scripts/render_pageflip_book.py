import os
import math
from pathlib import Path

import cv2
import numpy as np

_REPO_ROOT = Path(__file__).resolve().parent.parent

SRC_A = "/Users/davidolapade/Downloads/Barber_Shop_Website_Video_Generation.mp4"
SRC_B = "/Users/davidolapade/Downloads/Black_Man_Enters_Classic_Fade_Barber_Shop.mp4"
OUT_DIR = str(_REPO_ROOT / "renders" / "pageflip_book")

W, H = 1920, 1080
FPS = 60
DURATION = 8.0
NAV_H = 120


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def open_video(path: str):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path}")
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    return cap, frame_count, src_fps


def sample_frame(cap, frame_count: int, source_fps: float, t: float):
    idx = int((t * source_fps) % max(frame_count, 1))
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    if not ok or frame is None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = cap.read()
        if not ok or frame is None:
            return np.zeros((H, W, 3), dtype=np.uint8)
    frame = cv2.resize(frame, (W, H - NAV_H), interpolation=cv2.INTER_CUBIC)
    return frame


def draw_navbar(canvas):
    cv2.rectangle(canvas, (0, 0), (W, NAV_H), (245, 245, 245), -1)
    cv2.line(canvas, (0, NAV_H - 2), (W, NAV_H - 2), (25, 120, 220), 2)
    cv2.putText(canvas, "THE", (42, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (30, 30, 30), 2, cv2.LINE_AA)
    cv2.putText(canvas, "CLASSIC FADE", (42, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.18, (20, 20, 20), 3, cv2.LINE_AA)

    menu = ["Home", "Book Online", "About", "Gallery", "Testimonials", "Contact"]
    x = 620
    for item in menu:
        cv2.putText(canvas, item, (x, 68), cv2.FONT_HERSHEY_SIMPLEX, 0.72, (35, 35, 35), 2, cv2.LINE_AA)
        x += 165

    cv2.rectangle(canvas, (1470, 29), (1710, 90), (56, 147, 235), -1)
    cv2.putText(canvas, "Book appointment", (1490, 67), cv2.FONT_HERSHEY_SIMPLEX, 0.61, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(canvas, "Log In", (1760, 68), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (30, 30, 30), 2, cv2.LINE_AA)


def compose_page(video_frame):
    canvas = np.zeros((H, W, 3), dtype=np.uint8)
    draw_navbar(canvas)
    canvas[NAV_H:, :] = video_frame

    center = (W // 2, NAV_H + ((H - NAV_H) // 2))
    cv2.circle(canvas, center, 62, (235, 235, 235), -1)
    pts = np.array(
        [
            (center[0] - 18, center[1] - 24),
            (center[0] - 18, center[1] + 24),
            (center[0] + 26, center[1]),
        ],
        np.int32,
    )
    cv2.fillPoly(canvas, [pts], (120, 120, 120))
    return canvas


def paper_texture(img, amount=0.035):
    noise = np.random.normal(0, 14, img.shape).astype(np.int16)
    textured = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return cv2.addWeighted(img, 1.0 - amount, textured, amount, 0)


def page_progress(t, start, duration):
    if t <= start:
        return 0.0
    if t >= start + duration:
        return 1.0
    x = (t - start) / duration
    return x * x * (3 - 2 * x)


def render_variant(output_path, flip_start, flip_duration, curl_strength, shadow_strength):
    cap_a, count_a, fps_a = open_video(SRC_A)
    cap_b, count_b, fps_b = open_video(SRC_B)

    writer = cv2.VideoWriter(
        output_path,
        cv2.VideoWriter_fourcc(*"mp4v"),
        FPS,
        (W, H),
    )
    if not writer.isOpened():
        raise RuntimeError(f"Could not open output: {output_path}")

    total_frames = int(DURATION * FPS)
    src_pts = np.float32([[0, 0], [W, 0], [W, H], [0, H]])

    for i in range(total_frames):
        t = i / FPS
        top_video = sample_frame(cap_a, count_a, fps_a, t)
        bottom_video = sample_frame(cap_b, count_b, fps_b, t + 0.35)

        top_page = compose_page(top_video)
        bottom_page = compose_page(bottom_video)
        top_page = paper_texture(top_page)

        p = page_progress(t, flip_start, flip_duration)
        frame = bottom_page.copy()

        if p < 1.0:
            fold_x = W * (1.0 - (0.93 * p))
            edge_lift = (H * curl_strength) * math.sin(math.pi * p)
            left_pull = W * 0.04 * p

            dst_pts = np.float32(
                [
                    [0 - left_pull, 0 + edge_lift * 0.25],
                    [fold_x, 0 + edge_lift],
                    [fold_x, H - edge_lift],
                    [0 - left_pull, H - edge_lift * 0.25],
                ]
            )

            Hm = cv2.getPerspectiveTransform(src_pts, dst_pts)
            warped = cv2.warpPerspective(top_page, Hm, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
            mask = cv2.warpPerspective(np.full((H, W), 255, np.uint8), Hm, (W, H), flags=cv2.INTER_NEAREST)
            mask3 = cv2.merge([mask, mask, mask])
            frame = np.where(mask3 > 0, warped, frame)

            fold_ix = int(max(0, min(W - 1, fold_x)))
            shadow_w = int(160 + 160 * p)
            x2 = min(W, fold_ix + shadow_w)
            if x2 > fold_ix:
                grad = np.linspace(shadow_strength * (1 - p * 0.35), 0, x2 - fold_ix).reshape(1, -1, 1)
                roi = frame[:, fold_ix:x2].astype(np.float32)
                roi *= (1.0 - grad)
                frame[:, fold_ix:x2] = np.clip(roi, 0, 255).astype(np.uint8)

            cv2.line(frame, (fold_ix, 0), (fold_ix, H), (255, 245, 225), 2)

        frame = cv2.GaussianBlur(frame, (0, 0), 0.3)
        writer.write(frame)

    writer.release()
    cap_a.release()
    cap_b.release()


def main():
    ensure_dir(OUT_DIR)
    variants = [
        ("classic-pageflip-01.mp4", 1.6, 2.1, 0.11, 0.33),
        ("classic-pageflip-02.mp4", 1.2, 2.5, 0.14, 0.40),
        ("classic-pageflip-03.mp4", 2.0, 1.9, 0.10, 0.36),
    ]
    for name, start, dur, curl, shadow in variants:
        out_path = os.path.join(OUT_DIR, name)
        render_variant(out_path, start, dur, curl, shadow)
        print(f"Rendered: {out_path}")


if __name__ == "__main__":
    main()
