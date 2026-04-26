"use client";

import { useState, type FormEvent } from "react";
import { submitContactMessage } from "@/app/actions/submit-contact";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success" };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontFamily: "var(--ff-body)",
  fontSize: "16px",
  color: "var(--ink-900)",
  background: "var(--linen-50)",
  border: "1px solid var(--ink-200)",
  borderRadius: "var(--r-sm)",
  outline: "none",
  transition: "border-color var(--trans), background var(--trans)",
  // Avoid iOS zoom on focus by keeping font-size >= 16px above.
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--ff-body)",
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-500)",
  marginBottom: "6px",
  fontWeight: 500,
};

const fieldWrapStyle: React.CSSProperties = {
  marginBottom: "20px",
};

export function ContactForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "submitting") return;

    const form = e.currentTarget;
    const data = new FormData(form);

    const input = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      message: String(data.get("message") ?? ""),
      website: String(data.get("website") ?? ""), // honeypot
    };

    setStatus({ kind: "submitting" });
    try {
      const res = await submitContactMessage(input);
      if (res.ok) {
        setStatus({ kind: "success" });
        form.reset();
      } else {
        setStatus({ kind: "error", message: res.error });
      }
    } catch {
      setStatus({
        kind: "error",
        message: "Something went wrong. Please try again.",
      });
    }
  }

  if (status.kind === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          marginTop: "32px",
          padding: "28px 24px",
          border: "1px solid var(--ink-100)",
          borderLeft: "3px solid var(--cedar-400)",
          borderRadius: "var(--r-md)",
          background: "var(--linen-100)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--ff-display)",
            fontWeight: 500,
            fontSize: "22px",
            letterSpacing: "-0.01em",
            margin: "0 0 8px 0",
            color: "var(--ink-900)",
          }}
        >
          Thanks — we&apos;ll get back to you soon.
        </h2>
        <p
          style={{
            fontFamily: "var(--ff-reading)",
            fontStyle: "italic",
            fontSize: "16px",
            lineHeight: 1.5,
            color: "var(--ink-500)",
            margin: 0,
          }}
        >
          Your message landed safely. Expect a reply at the email you provided.
        </p>
      </div>
    );
  }

  const submitting = status.kind === "submitting";

  return (
    <form onSubmit={handleSubmit} noValidate style={{ marginTop: "8px" }}>
      {/* Honeypot — bots fill this, real users never see it. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-10000px",
          top: "auto",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      />

      <div style={fieldWrapStyle}>
        <label htmlFor="contact-name" style={labelStyle}>
          Name
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          required
          autoComplete="name"
          maxLength={200}
          disabled={submitting}
          style={inputStyle}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label htmlFor="contact-email" style={labelStyle}>
          Email
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={320}
          disabled={submitting}
          style={inputStyle}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label htmlFor="contact-message" style={labelStyle}>
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={6}
          maxLength={5000}
          disabled={submitting}
          style={{
            ...inputStyle,
            resize: "vertical",
            minHeight: "140px",
            lineHeight: 1.5,
            fontFamily: "var(--ff-reading)",
          }}
        />
      </div>

      {status.kind === "error" && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            marginBottom: "16px",
            padding: "12px 14px",
            background: "rgba(194,81,79,0.08)",
            border: "1px solid rgba(194,81,79,0.25)",
            borderRadius: "var(--r-sm)",
            fontFamily: "var(--ff-body)",
            fontSize: "14px",
            color: "#9c3a39",
          }}
        >
          {status.message}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
          marginTop: "8px",
        }}
      >
        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting}
          style={{
            opacity: submitting ? 0.7 : 1,
            cursor: submitting ? "wait" : "pointer",
          }}
        >
          {submitting ? "Sending…" : "Send message"}
          {!submitting && (
            <span aria-hidden="true" className="btn-arrow">
              →
            </span>
          )}
        </button>
        <span
          style={{
            fontFamily: "var(--ff-reading)",
            fontStyle: "italic",
            fontSize: "13px",
            color: "var(--ink-400)",
          }}
        >
          We&apos;ll only use your email to reply.
        </span>
      </div>
    </form>
  );
}
