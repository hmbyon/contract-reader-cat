"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./MaskEditor.module.css";

/**
 * 외부로 보내기 전에 브라우저에서 개인정보를 가리는 화면.
 * 이미지는 이 컴포넌트 안(canvas)에서만 다루며, "글자 읽기"를 눌러야 가린 결과가 평면화된 JPEG로 만들어진다.
 * 이미지·파일 내용은 console, localStorage, URL에 남기지 않는다.
 */

const MAX_LONG_SIDE = 1600;
const MAX_TOTAL_DATA_URL_CHARS = 2_900_000; // 서버 한도(base64 합계 약 3MB)보다 약간 작게
const JPEG_QUALITIES = [0.85, 0.7, 0.55];

const PEN_SIZES = [
  { label: "가늘게", value: 16 },
  { label: "보통", value: 32 },
  { label: "굵게", value: 56 },
] as const;

type Tool = "rect" | "pen";

type Op =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "stroke"; size: number; points: { x: number; y: number }[] };

interface Props {
  files: File[];
  busy: boolean;
  onCancel: () => void;
  onError: (message: string) => void;
  /** 가려서 평면화한 JPEG data URL(순서대로). 원본은 넘기지 않는다. */
  onSubmit: (jpegDataUrls: string[]) => void;
}

export const DECODE_ERROR_MESSAGE =
  "이 사진은 읽을 수 없어요. JPG나 PNG 사진으로 바꿔서 올려 주세요";

function paint(
  canvas: HTMLCanvasElement,
  base: HTMLCanvasElement,
  ops: Op[],
  preview?: Op | null
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);

  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const all = preview ? [...ops, preview] : ops;
  for (const op of all) {
    if (op.kind === "rect") {
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.points.length === 1) {
      ctx.beginPath();
      ctx.arc(op.points[0].x, op.points[0].y, op.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = op.size;
      ctx.beginPath();
      ctx.moveTo(op.points[0].x, op.points[0].y);
      for (let i = 1; i < op.points.length; i++) {
        ctx.lineTo(op.points[i].x, op.points[i].y);
      }
      ctx.stroke();
    }
  }
}

async function decodeToBase(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const base = document.createElement("canvas");
    base.width = width;
    base.height = height;
    const ctx = base.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return base;
  } finally {
    bitmap.close();
  }
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

export default function MaskEditor({ files, busy, onCancel, onError, onSubmit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const basesRef = useRef<HTMLCanvasElement[]>([]);
  const opsRef = useRef<Op[][]>([]);
  const draftRef = useRef<Op | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const [tool, setTool] = useState<Tool>("rect");
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[1].value);
  const [confirmed, setConfirmed] = useState(false);
  const [, setTick] = useState(0);

  const total = files.length;
  const rerender = useCallback(() => setTick((n) => n + 1), []);

  // 이미지 디코딩 (EXIF 방향 보정, 긴 변 1600px 이하로 축소)
  useEffect(() => {
    let cancelled = false;
    const bases: HTMLCanvasElement[] = [];

    (async () => {
      try {
        for (const file of files) {
          const base = await decodeToBase(file);
          if (cancelled) {
            releaseCanvas(base);
            return;
          }
          bases.push(base);
        }
        basesRef.current = bases;
        opsRef.current = bases.map(() => []);
        setIndex(0);
        setVisited(new Set([0]));
        setReady(true);
      } catch {
        if (!cancelled) onError(DECODE_ERROR_MESSAGE);
      }
    })();

    return () => {
      cancelled = true;
      bases.forEach(releaseCanvas);
      basesRef.current = [];
      opsRef.current = [];
      setReady(false);
    };
    // files는 부모가 새 배열을 만들 때만 바뀐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const base = basesRef.current[index];
    if (!canvas || !base) return;
    if (canvas.width !== base.width || canvas.height !== base.height) {
      canvas.width = base.width;
      canvas.height = base.height;
    }
    paint(canvas, base, opsRef.current[index] ?? [], draftRef.current);
  }, [index]);

  useEffect(() => {
    if (ready) draw();
  });

  function toCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (busy || activePointerRef.current !== null) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 캡처를 못 해도 그리기는 계속한다.
    }
    activePointerRef.current = event.pointerId;

    const point = toCanvasPoint(event);
    startRef.current = point;
    draftRef.current =
      tool === "rect"
        ? { kind: "rect", x: point.x, y: point.y, w: 0, h: 0 }
        : { kind: "stroke", size: penSize, points: [point] };
    draw();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId || !draftRef.current) return;
    const point = toCanvasPoint(event);
    const draft = draftRef.current;

    if (draft.kind === "rect" && startRef.current) {
      const start = startRef.current;
      draftRef.current = {
        kind: "rect",
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        w: Math.abs(point.x - start.x),
        h: Math.abs(point.y - start.y),
      };
    } else if (draft.kind === "stroke") {
      draft.points.push(point);
    }
    draw();
  }

  function finishPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    startRef.current = null;

    const draft = draftRef.current;
    draftRef.current = null;

    if (draft && (draft.kind === "stroke" || (draft.w >= 3 && draft.h >= 3))) {
      opsRef.current[index] = [...(opsRef.current[index] ?? []), draft];
    }
    rerender();
  }

  function undo() {
    const ops = opsRef.current[index];
    if (!ops || ops.length === 0) return;
    opsRef.current[index] = ops.slice(0, -1);
    rerender();
  }

  function clearAll() {
    opsRef.current[index] = [];
    rerender();
  }

  function goTo(next: number) {
    if (next < 0 || next >= total) return;
    setIndex(next);
    setVisited((prev) => new Set(prev).add(next));
  }

  function exportAll(): string[] | null {
    for (const quality of JPEG_QUALITIES) {
      const urls: string[] = [];
      let size = 0;

      for (let i = 0; i < basesRef.current.length; i++) {
        const base = basesRef.current[i];
        // 가린 부분이 픽셀로 반영된 새 평면 이미지를 만든다. (불투명 검정, 원본·EXIF 미포함)
        const flat = document.createElement("canvas");
        flat.width = base.width;
        flat.height = base.height;
        paint(flat, base, opsRef.current[i] ?? []);
        const url = flat.toDataURL("image/jpeg", quality);
        releaseCanvas(flat);
        size += url.length;
        urls.push(url);
      }

      if (size <= MAX_TOTAL_DATA_URL_CHARS) return urls;
    }
    return null;
  }

  function handleSubmit() {
    const urls = exportAll();
    if (!urls) {
      onError("사진 용량이 너무 커요. 장수를 줄이거나 더 작은 사진을 올려 주세요");
      return;
    }
    onSubmit(urls);
  }

  const allVisited = visited.size === total;
  const canSubmit = ready && !busy && confirmed && allVisited;
  const opCount = opsRef.current[index]?.length ?? 0;

  return (
    <div className={styles.editor}>
      <p className={styles.guide}>
        이름, 주소, 연락처, 주민등록번호, 계좌번호, 서명·도장 등 개인정보를 모두 검정색으로 가려
        주세요. 가린 이미지만 AI로 보내요.
      </p>

      {!ready ? (
        <p className={styles.preparing} role="status">
          사진을 준비하는 중…
        </p>
      ) : (
        <>
          <div className={styles.topRow}>
            <p className={styles.progress} aria-live="polite">
              {index + 1}/{total}
            </p>
            {total > 1 && (
              <div className={styles.pager}>
                <button
                  type="button"
                  className={styles.toolButton}
                  onClick={() => goTo(index - 1)}
                  disabled={index === 0 || busy}
                >
                  이전
                </button>
                <button
                  type="button"
                  className={styles.toolButton}
                  onClick={() => goTo(index + 1)}
                  disabled={index === total - 1 || busy}
                >
                  다음
                </button>
              </div>
            )}
          </div>

          <div className={styles.toolbar} role="toolbar" aria-label="가리기 도구">
            <button
              type="button"
              className={styles.toolButton}
              aria-pressed={tool === "rect"}
              onClick={() => setTool("rect")}
            >
              사각형 가리기
            </button>
            <button
              type="button"
              className={styles.toolButton}
              aria-pressed={tool === "pen"}
              onClick={() => setTool("pen")}
            >
              펜
            </button>
            {tool === "pen" &&
              PEN_SIZES.map((pen) => (
                <button
                  key={pen.value}
                  type="button"
                  className={styles.toolButton}
                  aria-pressed={penSize === pen.value}
                  onClick={() => setPenSize(pen.value)}
                >
                  {pen.label}
                </button>
              ))}
            <button type="button" className={styles.toolButton} onClick={undo} disabled={opCount === 0}>
              실행 취소
            </button>
            <button
              type="button"
              className={styles.toolButton}
              onClick={clearAll}
              disabled={opCount === 0}
            >
              전체 지우기
            </button>
          </div>

          <div className={styles.canvasWrap}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              aria-label={`가리기 화면 ${index + 1}번째 사진. 마우스나 손가락으로 끌어서 개인정보를 가려 주세요.`}
            />
          </div>

          {!allVisited && total > 1 && (
            <p className={styles.hint}>모든 사진을 한 번씩 확인해야 글자를 읽을 수 있어요.</p>
          )}
        </>
      )}

      <label className={styles.confirm}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={busy}
        />
        <span>개인정보를 모두 가렸어요</span>
      </label>

      <div className={styles.footerRow}>
        <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button
          type="button"
          className={styles.readButton}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {busy ? "읽는 중…" : "글자 읽기"}
        </button>
      </div>
    </div>
  );
}
