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
  const [struggling, setStruggling] = useState(false);

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
          // A sharper frame than the default 640×480: small codes need the pixels.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
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

      // The browser's own QR reader where there is one (Chrome on Mac/Android):
      // faster and better with glare and angles. Safari on iPhone/iPad has
      // none, so jsQR decodes there.
      const detector = await nativeQrDetector();
      if (stopped) return; // left the page while the reader was starting
      let tick = 0;
      let lastSeenAt = Date.now();
      let busy = false;

      const report = (raw: string | undefined) => {
        const code = raw?.trim();
        if (!code) return false;
        const now = Date.now();
        lastSeenAt = now;
        setStruggling(false);
        const last = lastRef.current;
        if (last && last.code === code && now - last.at < 4000) return true;
        lastRef.current = { code, at: now };
        navigator.vibrate?.(80);
        onCodeRef.current(code);
        return true;
      };

      timer = setInterval(async () => {
        const canvas = canvasRef.current;
        if (busy || pausedRef.current || !canvas || video.readyState < 2 || !video.videoWidth) {
          return;
        }
        busy = true;
        try {
          tick += 1;
          if (Date.now() - lastSeenAt > 6000) setStruggling(true);

          if (detector) {
            const found = await detector.detect(video).catch(() => []);
            report(found[0]?.rawValue);
            return;
          }

          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (tick % 3 !== 0) {
            // Mostly: the middle of the frame (where the aiming square is) at
            // full resolution — shrinking the whole frame loses small codes.
            const side = Math.round(Math.min(vw, vh) * 0.8);
            const target = Math.min(side, 1000);
            canvas.width = target;
            canvas.height = target;
            context.drawImage(
              video,
              Math.round((vw - side) / 2),
              Math.round((vh - side) / 2),
              side,
              side,
              0,
              0,
              target,
              target,
            );
          } else {
            // Every third frame: the whole picture, for a code held off-centre.
            const scale = Math.min(1, 960 / vw);
            canvas.width = Math.round(vw * scale);
            canvas.height = Math.round(vh * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(image.data, image.width, image.height, {
            inversionAttempts: "attemptBoth",
          });
          report(found?.data);
        } finally {
          busy = false;
        }
      }, 150);
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
      {struggling && !paused && (
        <p className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-xs text-white">
          Can&apos;t see a code yet. Hold it 15–25 cm away so it fills the square, keep it still,
          and tilt a phone screen to avoid glare.
        </p>
      )}
    </div>
  );
}

interface QrDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

/** The browser's built-in BarcodeDetector for QR codes, or null where it's missing (iPhone/iPad Safari). */
async function nativeQrDetector(): Promise<QrDetector | null> {
  const Detector = (
    window as unknown as {
      BarcodeDetector?: {
        new (options: { formats: string[] }): QrDetector;
        getSupportedFormats?: () => Promise<string[]>;
      };
    }
  ).BarcodeDetector;
  if (!Detector) return null;
  try {
    const formats = (await Detector.getSupportedFormats?.()) ?? [];
    return formats.includes("qr_code") ? new Detector({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}
