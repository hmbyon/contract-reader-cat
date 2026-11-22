"use client";

import { useRef, useState } from "react";
import type { AnalyzeResult, Finding } from "@/lib/analyze";
import { SAMPLES } from "@/lib/samples";
import MaskEditor from "./MaskEditor";
import styles from "./page.module.css";

const FAILURE_MESSAGE = "분석에 실패했습니다. 잠시 후 다시 시도해 주세요";

const MAX_IMAGES = 5;
const MAX_TEXT_FILE_BYTES = 200 * 1024;
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
const READ_FAILURE_MESSAGE = "글자 읽기에 실패했어요. 잠시 후 다시 시도해 주세요";
const UNREADABLE_TOKEN = "[판독불가]";

function isTextFile(file: File): boolean {
  return file.type === "text/plain" || /\.txt$/i.test(file.name);
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

async function readTextFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

interface FileChip {
  id: number;
  name: string;
}

const TYPE_LABEL: Record<AnalyzeResult["type"], string> = {
  work: "근로계약서",
  rent: "월세 계약서",
  other: "기타",
};

const STATUS_LABEL: Record<Finding["status"], string> = {
  risk: "⚠ 위험 가능",
  check: "? 확인 필요",
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className={styles.copyButton} onClick={handleCopy}>
      {copied ? "복사됨" : "복사"}
    </button>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const { basis } = finding;
  const isRisk = finding.status === "risk";

  return (
    <li className={`${styles.card} ${isRisk ? styles.cardRisk : styles.cardCheck}`}>
      <div className={styles.cardHeader}>
        <h3 className={styles.clauseTitle}>
          {finding.clause_no}
          {finding.clause_title ? ` ${finding.clause_title}` : ""}
        </h3>
        <span className={`${styles.badge} ${isRisk ? styles.badgeRisk : styles.badgeCheck}`}>
          {STATUS_LABEL[finding.status]}
        </span>
      </div>

      <p className={styles.criteriaTitle}>점검 항목: {finding.title}</p>

      {finding.quote && (
        <blockquote className={styles.quote}>
          <mark>{finding.quote}</mark>
        </blockquote>
      )}

      <p className={styles.explanation}>{finding.explanation}</p>

      <dl className={styles.meta}>
        <div>
          <dt>근거</dt>
          <dd>
            {basis.law} · {basis.article}
            {!basis.verified && <span className={styles.unverified}>법령 근거 확인 전</span>}
          </dd>
        </div>
        <div>
          <dt>확신도</dt>
          <dd>{percent(finding.confidence)}</dd>
        </div>
      </dl>

      <div className={styles.block}>
        <p className={styles.blockLabel}>서명 전에 물어볼 질문</p>
        <p>{finding.user_question}</p>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <p className={styles.blockLabel}>수정 요청 문구</p>
          <CopyButton text={finding.edit_suggestion} />
        </div>
        <p>{finding.edit_suggestion}</p>
      </div>
    </li>
  );
}

export default function Home() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [chips, setChips] = useState<FileChip[]>([]);
  const [reading, setReading] = useState(false);
  const [ocrNote, setOcrNote] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chipIdRef = useRef(0);

  function nextChipId() {
    chipIdRef.current += 1;
    return chipIdRef.current;
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0 || reading) return;
    setUploadError(null);

    if (files.some(isPdfFile)) {
      setUploadError("PDF는 아직 지원하지 않아요. 화면을 캡처하거나 사진으로 찍어 올려 주세요");
      return;
    }

    const texts = files.filter(isTextFile);
    const images = files.filter((file) => !isTextFile(file) && isImageFile(file));

    if (texts.length + images.length !== files.length) {
      setUploadError("지원하지 않는 형식이에요. 사진(JPG·PNG 등)이나 .txt 파일을 올려 주세요");
      return;
    }
    if (texts.length > 0 && images.length > 0) {
      setUploadError("텍스트 파일과 사진은 따로 올려 주세요");
      return;
    }

    if (texts.length > 0) {
      if (texts.length > 1) {
        setUploadError("텍스트 파일은 한 번에 하나만 올릴 수 있어요");
        return;
      }
      const file = texts[0];
      if (file.size > MAX_TEXT_FILE_BYTES) {
        setUploadError("텍스트 파일이 너무 커요. 200KB 이하로 올려 주세요");
        return;
      }
      try {
        setText(await readTextFile(file));
        setPendingImages([]);
        setOcrNote(false);
        setChips([{ id: nextChipId(), name: file.name }]);
      } catch {
        setUploadError("파일을 읽지 못했어요. 다시 시도해 주세요");
      }
      return;
    }

    if (images.length > MAX_IMAGES) {
      setUploadError(`사진은 최대 ${MAX_IMAGES}장까지 올릴 수 있어요`);
      return;
    }
    if (images.some((file) => file.size > MAX_IMAGE_FILE_BYTES)) {
      setUploadError("사진 용량이 너무 커요. 20MB 이하로 올려 주세요");
      return;
    }

    setChips(images.map((file) => ({ id: nextChipId(), name: file.name })));
    setPendingImages(images);
  }

  function handleRemoveChip(id: number, index: number) {
    setChips((prev) => prev.filter((chip) => chip.id !== id));
    // 가리기 대기 중인 사진이면 목록에서도 뺀다. 입력창 내용은 그대로 둔다.
    setPendingImages((prev) => (prev.length > 0 ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleMaskCancel() {
    setPendingImages([]);
    setChips([]);
  }

  async function handleMaskSubmit(jpegDataUrls: string[]) {
    if (reading) return;
    const names = chips.map((chip) => chip.name);

    setReading(true);
    setUploadError(null);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: jpegDataUrls.map((url) => ({
            mimeType: "image/jpeg",
            data: url.replace(/^data:image\/jpeg;base64,/, ""),
          })),
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { text?: unknown };
        if (typeof data.text === "string" && data.text.trim().length > 0) {
          setText(data.text);
          setOcrNote(true);
          setPendingImages([]); // 가리기 화면을 닫으면서 canvas를 해제한다.
          setChips(names.map((name) => ({ id: nextChipId(), name })));
        } else {
          setUploadError("글자를 읽지 못했어요. 사진을 더 선명하게 찍어 다시 올려 주세요");
        }
      } else if (response.status === 400 || response.status === 422) {
        let message = READ_FAILURE_MESSAGE;
        try {
          const data = (await response.json()) as { error?: unknown };
          if (typeof data.error === "string" && data.error) message = data.error;
        } catch {
          // 본문을 읽지 못하면 기본 문구를 쓴다.
        }
        setUploadError(message);
      } else {
        setUploadError(READ_FAILURE_MESSAGE);
      }
    } catch {
      setUploadError(READ_FAILURE_MESSAGE);
    } finally {
      setReading(false);
    }
  }

  const showOcrNote = ocrNote && text !== SAMPLES.work && text !== SAMPLES.rent;

  async function handleAnalyze() {
    if (loading || text.trim().length === 0) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        setResult((await response.json()) as AnalyzeResult);
      } else if (response.status === 400) {
        let message = FAILURE_MESSAGE;
        try {
          const data = (await response.json()) as { error?: unknown };
          if (typeof data.error === "string" && data.error) message = data.error;
        } catch {
          // 본문을 읽지 못하면 기본 문구를 쓴다.
        }
        setError(message);
      } else {
        setError(FAILURE_MESSAGE);
      }
    } catch {
      setError(FAILURE_MESSAGE);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <span className={`${styles.blob} ${styles.blobLeft}`} aria-hidden="true" />
      <span className={`${styles.blob} ${styles.blobRight}`} aria-hidden="true" />

      <main className={styles.main}>
        <header className={styles.siteHeader}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cat-logo.png"
            alt=""
            className={styles.logo}
            width={56}
            height={47}
            decoding="async"
          />
          <span className={styles.brand}>계읽냥</span>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroText}>
            <h1 className={styles.title}>계읽냥</h1>
            <p className={styles.subtitle}>서명 전에 계약서를 먼저 읽어 주는 AI 점검 도구</p>
            <p className={styles.lead}>복잡한 계약서도, 이제는 쉽게 확인해요</p>
          </div>
          <div className={styles.heroArt}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/cat-hero.png"
              alt="안경을 쓴 고양이가 계약서의 한 줄에 노란 형광펜을 칠하고 있는 그림"
              className={styles.heroImg}
              width={770}
              height={368}
              loading="eager"
              decoding="async"
            />
          </div>
          <span className={`${styles.paw} ${styles.pawA}`} aria-hidden="true" />
          <span className={`${styles.paw} ${styles.pawB}`} aria-hidden="true" />
          <span className={styles.sparkle} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </section>

        <section className={styles.inputCard}>
          <div className={styles.inputInner}>
            <p className={styles.banner} role="note">
              가상 계약서만 입력하세요. 실제 이름·연락처·주민번호는 넣지 마세요.
            </p>
            {pendingImages.length > 0 ? (
              <MaskEditor
                files={pendingImages}
                busy={reading}
                onCancel={handleMaskCancel}
                onError={(message) => {
                  setUploadError(message);
                  handleMaskCancel();
                }}
                onSubmit={handleMaskSubmit}
              />
            ) : (
              <div
                className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void handleFiles(event.dataTransfer.files);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.txt,text/plain"
                  className={styles.fileInput}
                  tabIndex={-1}
                  onChange={(event) => {
                    void handleFiles(event.target.files ?? []);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className={styles.uploadButton}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={reading}
                >
                  사진 올리기
                </button>
                <p className={styles.dropHint}>
                  계약서 사진(최대 5장)이나 .txt 파일을 여기에 끌어다 놓아도 돼요
                </p>
              </div>
            )}

            {chips.length > 0 && (
              <ul className={styles.chips}>
                {chips.map((chip, index) => (
                  <li key={chip.id} className={styles.chip}>
                    <span className={styles.chipName}>{chip.name}</span>
                    <button
                      type="button"
                      className={styles.chipRemove}
                      onClick={() => handleRemoveChip(chip.id, index)}
                      aria-label={`${chip.name} 지우기`}
                      disabled={reading}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {uploadError && (
              <p className={styles.uploadError} role="alert">
                {uploadError}
              </p>
            )}

            {showOcrNote && (
              <div className={styles.ocrNote} role="note">
                <p>사진에서 읽은 글자는 틀릴 수 있어요. 확인하고 고친 뒤 점검해 주세요.</p>
                {text.includes(UNREADABLE_TOKEN) && (
                  <p>[판독불가] 부분은 직접 채워 주세요</p>
                )}
              </div>
            )}

            <label htmlFor="contract-text" className={styles.label}>
              계약서 내용
            </label>
            <textarea
              id="contract-text"
              className={styles.textarea}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="점검할 계약서 내용을 붙여 넣거나 아래 샘플을 불러오세요."
              rows={12}
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setText(SAMPLES.work)}
              >
                근로계약서 샘플
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setText(SAMPLES.rent)}
              >
                월세 계약서 샘플
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleAnalyze}
                disabled={loading || reading || text.trim().length === 0}
              >
                {loading ? "점검 중…" : "점검하기"}
              </button>
            </div>
          </div>
        </section>

        {reading && (
          <div className={styles.loading} role="status">
            <p className={styles.loadingText}>
              <span className={styles.loadingMark}>계읽냥이 글자를 읽는 중…</span>
            </p>
          </div>
        )}

        {loading && (
          <div className={styles.loading} role="status">
            <p className={styles.loadingText}>
              <span className={styles.loadingMark}>계읽냥이 계약서를 읽는 중…</span>
            </p>
          </div>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {result && (
          <section className={styles.results} aria-live="polite">
            <div className={styles.summary}>
              <p className={styles.summaryType}>
                {TYPE_LABEL[result.type]}
                <span className={styles.summaryConfidence}>
                  {" "}
                  (유형 확신도 {percent(result.type_confidence)})
                </span>
              </p>
              <p className={styles.summaryCount}>
                위험 가능 {result.summary.risk}건 · 확인 필요 {result.summary.check}건
              </p>
              {result.type_notice && <p className={styles.typeNotice}>{result.type_notice}</p>}
            </div>

            {result.findings.length === 0 ? (
              <p className={styles.empty}>
                점검 기준에서 걸린 조항이 없습니다. 그래도 서명 전에 전체를 직접 읽어 보세요.
              </p>
            ) : (
              <ul className={styles.cardList}>
                {result.findings.map((finding) => (
                  <FindingCard
                    key={`${finding.clause_no}-${finding.criteria_id}`}
                    finding={finding}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        <p>{result?.notice ?? "AI가 생성한 결과이며 법률 자문이 아닌 점검 도구입니다."}</p>
        <p>AI는 틀릴 수 있습니다. 중요한 계약은 전문가와 상담하세요.</p>
      </footer>
    </div>
  );
}
