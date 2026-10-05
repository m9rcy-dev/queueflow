"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * The phone/tablet camera as a QR reader (Phase 19) — the backup when the
 * counter scanner is broken or missing. iPhone/iPad Safari has no built-in
 * QR decoding for web pages, so frames are decoded with jsQR. Calls
 * `onCode` once per code: the same code is ignored for a few seconds, so
 * holding a phone in front of the camera doesn't scan it twice.
 *
 * Needs a secure page (HTTPS, or localhost) — browsers only offer the
 * camera there.
 */
export function CameraScanner({
  onCode,
  paused,
}: {
  onCode: (code: string) => void;
  /** True while the previous scan is being processed. */
  paused: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  const [error, setError] = useState<string | null>(null);

  pausedRef.current = paused;
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(
          "The camera needs a secure (https://) address. It works on the live site; locally, use localhost on this computer.",
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        setError(
          "Couldn't open the camera. Allow camera access for this site (on iPhone/iPad: Settings › Safari › Camera), then try again.",
        );
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true"); // iOS: don't go full screen
      await video.play().catch(() => undefined);

      timer = setInterval(() => {
        const canvas = canvasRef.current;
        if (pausedRef.current || !canvas || video.readyState < 2 || !video.videoWidth) return;
        // Decode a downscaled frame — plenty for a QR held up to the camera, and fast on phones.
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, {
          inversionAttempts: "dontInvert",
        });
        const code = found?.data.trim();
        if (!code) return;
        const now = Date.now();
        const last = lastRef.current;
        if (last && last.code === code && now - last.at < 4000) return;
        lastRef.current = { code, at: now };
        navigator.vibrate?.(80);
        onCodeRef.current(code);
      }, 200);
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (error) {
    return (
      <p role="alert" className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {error}
      </p>
    );
  }
  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-black">
      <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" />
      {/* An aiming square, so people know where to hold the code. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-[18%] rounded-xl border-4 ${
          paused ? "border-amber-300" : "border-white/80"
        }`}
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
