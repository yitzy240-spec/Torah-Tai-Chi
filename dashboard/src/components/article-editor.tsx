'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { useCallback, useEffect, useRef } from 'react';

interface ArticleEditorProps {
  initialContent?: object | null;
  onChange: (doc: object, html: string) => void;
  placeholder?: string;
}

function serializeToHtml(html: string): string {
  return html;
}

export function ArticleEditor({ initialContent, onChange, placeholder = 'Begin writing…' }: ArticleEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    onUpdate({ editor }) {
      const doc = editor.getJSON();
      const html = editor.getHTML();
      onChangeRef.current(doc, html);
    },
    editorProps: {
      attributes: {
        style: [
          'font-family: var(--ff-display)',
          'font-size: 17px',
          'line-height: 1.75',
          'color: var(--ink-900)',
          'max-width: 62ch',
          'min-height: 320px',
          'outline: none',
          'padding: 20px 0 40px',
        ].join(';'),
        class: 'article-editor-content',
      },
    },
  });

  const handleLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('URL');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    } else if (url === '') {
      editor.chain().focus().unsetLink().run();
    }
  }, [editor]);

  if (!editor) return null;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '34px',
    height: '34px',
    minHeight: '34px',
    borderRadius: 'var(--r-sm)',
    border: 'none',
    background: active ? 'var(--navy-100)' : 'transparent',
    color: active ? 'var(--navy-800)' : 'var(--ink-600)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    transition: 'all var(--trans)',
    fontFamily: 'var(--ff-body)',
  });

  return (
    <div
      style={{
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        background: 'white',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: '2px',
          flexWrap: 'wrap',
          padding: '8px 12px',
          borderBottom: '1px solid var(--ink-100)',
          background: 'var(--linen-50)',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          title="Heading 2"
          style={btnStyle(editor.isActive('heading', { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
        <button
          type="button"
          title="Heading 3"
          style={btnStyle(editor.isActive('heading', { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </button>

        <div style={{ width: '1px', height: '22px', background: 'var(--ink-200)', margin: '0 4px' }} />

        <button
          type="button"
          title="Bold"
          style={{ ...btnStyle(editor.isActive('bold')), fontWeight: 700 }}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          type="button"
          title="Italic"
          style={{ ...btnStyle(editor.isActive('italic')), fontStyle: 'italic' }}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </button>

        <div style={{ width: '1px', height: '22px', background: 'var(--ink-200)', margin: '0 4px' }} />

        <button
          type="button"
          title="Bullet list"
          style={btnStyle(editor.isActive('bulletList'))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <circle cx="2.5" cy="4" r="1.2"/><rect x="5" y="3" width="9" height="2" rx="1"/>
            <circle cx="2.5" cy="8" r="1.2"/><rect x="5" y="7" width="9" height="2" rx="1"/>
            <circle cx="2.5" cy="12" r="1.2"/><rect x="5" y="11" width="9" height="2" rx="1"/>
          </svg>
        </button>
        <button
          type="button"
          title="Numbered list"
          style={btnStyle(editor.isActive('orderedList'))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <text x="0.5" y="5.5" fontSize="5.5" fontWeight="700">1.</text>
            <rect x="6" y="3" width="8" height="2" rx="1"/>
            <text x="0.5" y="9.5" fontSize="5.5" fontWeight="700">2.</text>
            <rect x="6" y="7" width="8" height="2" rx="1"/>
            <text x="0.5" y="13.5" fontSize="5.5" fontWeight="700">3.</text>
            <rect x="6" y="11" width="8" height="2" rx="1"/>
          </svg>
        </button>

        <div style={{ width: '1px', height: '22px', background: 'var(--ink-200)', margin: '0 4px' }} />

        <button
          type="button"
          title="Link"
          style={btnStyle(editor.isActive('link'))}
          onClick={handleLink}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4"/>
            <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L9 12"/>
          </svg>
        </button>
        <button
          type="button"
          title="Blockquote"
          style={btnStyle(editor.isActive('blockquote'))}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M3 4a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1.5l-1 3h1.5l1.5-3.5V5a1 1 0 0 0-1-1H3zm7 0a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1.5l-1 3H12l1.5-3.5V5a1 1 0 0 0-1-1H10z"/>
          </svg>
        </button>
      </div>

      {/* Editor area */}
      <div style={{ padding: '0 24px' }}>
        <EditorContent editor={editor} />
      </div>

      <style>{`
        .article-editor-content p { margin: 0 0 1.2em 0; }
        .article-editor-content h2 {
          font-family: var(--ff-display);
          font-size: 22px;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: var(--ink-900);
          margin: 1.6em 0 0.6em;
          font-variation-settings: "opsz" 36, "SOFT" 30;
        }
        .article-editor-content h3 {
          font-family: var(--ff-display);
          font-size: 18px;
          font-weight: 500;
          color: var(--ink-900);
          margin: 1.4em 0 0.5em;
          font-variation-settings: "opsz" 22, "SOFT" 30;
        }
        .article-editor-content blockquote {
          border-left: 3px solid var(--cedar-300);
          margin: 1.2em 0;
          padding: 0.4em 0 0.4em 1.2em;
          color: var(--ink-700);
          font-style: italic;
        }
        .article-editor-content ul, .article-editor-content ol {
          margin: 0.8em 0 1.2em;
          padding-left: 1.6em;
        }
        .article-editor-content li { margin-bottom: 0.3em; }
        .article-editor-content a { color: var(--navy-700); text-decoration: underline; }
        .article-editor-content a:hover { color: var(--navy-900); }
        .article-editor-content .tiptap.ProseMirror { outline: none; }
        .article-editor-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--ink-300);
          pointer-events: none;
          height: 0;
          font-style: italic;
        }
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--ink-300);
          pointer-events: none;
          height: 0;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
