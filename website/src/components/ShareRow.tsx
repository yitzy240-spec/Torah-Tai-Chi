'use client';

import { useState } from 'react';

interface Props {
  url: string;
  title: string;
}

/**
 * Compact share row for the bottom of a teaching detail page.
 * - On devices with the Web Share API (most mobile browsers), the leading
 *   "Share" button opens the native sheet.
 * - Always shows direct WhatsApp / X / Facebook links + a copy-link button
 *   so desktop users have a path too.
 */
export default function ShareRow({ url, title }: Props) {
  const [copied, setCopied] = useState(false);
  const text = `${title} — Torah Tai Chi`;

  const canNativeShare =
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { share?: unknown }).share === 'function';

  const onNativeShare = async () => {
    try {
      await navigator.share({ title: text, url });
    } catch {
      // user cancelled — no-op
    }
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const enc = (s: string) => encodeURIComponent(s);
  const whatsappUrl = `https://api.whatsapp.com/send?text=${enc(text + ' ' + url)}`;
  const xUrl = `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`;
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`;

  return (
    <section className="share-row" aria-label="Share this teaching">
      <div className="share-label">Share this teaching</div>
      <div className="share-buttons">
        {canNativeShare && (
          <button type="button" onClick={onNativeShare} className="share-btn share-btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            Share
          </button>
        )}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="share-btn"
          aria-label="Share on WhatsApp"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.5 3.5A11 11 0 0 0 3.4 17.2L2 22l4.9-1.4A11 11 0 0 0 23 12a11 11 0 0 0-2.5-8.5zM12 20a8.1 8.1 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8.1 8.1 0 1 1 20.1 12 8.1 8.1 0 0 1 12 20zm4.4-6c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.2-2.8c-.2-.4.2-.4.6-1.2.1-.1 0-.3 0-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.4a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.8 2c0 1.2.8 2.3.9 2.5a8.7 8.7 0 0 0 3.4 3 11 11 0 0 0 1.1.4 2.7 2.7 0 0 0 1.2.1 2 2 0 0 0 1.3-.9 1.6 1.6 0 0 0 .1-.9c-.1-.1-.3-.1-.5-.2z" />
          </svg>
          WhatsApp
        </a>
        <a
          href={xUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="share-btn"
          aria-label="Share on X"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          X
        </a>
        <a
          href={facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="share-btn"
          aria-label="Share on Facebook"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-3h2.5V9.5c0-2.5 1.5-3.9 3.7-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.7-1.6 1.5V12h2.7l-.4 3h-2.3v7A10 10 0 0 0 22 12z" />
          </svg>
          Facebook
        </a>
        <button type="button" onClick={onCopy} className="share-btn" aria-label="Copy link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </section>
  );
}
