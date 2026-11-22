"use client";

import { useState } from "react";
import type { AnalyzeResult, Finding } from "@/lib/analyze";
import { SAMPLES } from "@/lib/samples";
import styles from "./page.module.css";

const FAILURE_MESSAGE = "분석에 실패했습니다. 잠시 후 다시 시도해 주세요";

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
              width={730}
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
                disabled={loading || text.trim().length === 0}
              >
                {loading ? "점검 중…" : "점검하기"}
              </button>
            </div>
          </div>
        </section>

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
        <div className={styles.footerText}>
          <p>{result?.notice ?? "AI가 생성한 결과이며 법률 자문이 아닌 점검 도구입니다."}</p>
          <p>AI는 틀릴 수 있습니다. 중요한 계약은 전문가와 상담하세요.</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cat-peek.png"
          alt=""
          className={styles.peek}
          width={300}
          height={259}
          decoding="async"
        />
      </footer>
    </div>
  );
}
