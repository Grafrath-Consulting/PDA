'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import { Extension } from '@tiptap/core'
import { useState, useEffect, useLayoutEffect, useImperativeHandle, useRef, forwardRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { highlightHTML } from '@/lib/highlight-html'
import { createPortal } from 'react-dom'
import data from '@emoji-mart/data'

const EmojiPicker = lazy(() => import('@emoji-mart/react'))

const TabHandler = Extension.create({
  name: 'tabHandler',
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        editor.commands.insertContent('\t')
        return true
      },
      'Shift-Tab': () => true, // prevent reverse-focus navigation
    }
  },
})

export interface TipTapEditorHandle {
  getHTML: () => string
  getText: () => string
  clear: () => void
  focus: () => void
  focusAtCoords: (x: number, y: number) => void
  setContent: (html: string) => void
  openLinkEditor: (prefilledText?: string) => void
}

interface Props {
  content?: string
  placeholder?: string
  autoFocus?: boolean
  onSubmit?: () => void
  onChange?: (html: string, text: string) => void
  className?: string
  minHeight?: string
  editable?: boolean
  toolbarVisible?: boolean
  onReady?: (handle: TipTapEditorHandle) => void
  searchHighlight?: string | string[]
  matchedChunk?: string
}

export const TipTapEditor = forwardRef<TipTapEditorHandle, Props>(function TipTapEditor(
  { content = '', placeholder, autoFocus, onSubmit, onChange, className = '', minHeight = '0', editable = true, toolbarVisible = false, onReady, searchHighlight, matchedChunk },
  ref
) {
  // Keep refs so the closures inside useEditor always call the latest callbacks
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastHTMLRef = useRef(content)

  // Emoji picker state
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; right: number } | null>(null)
  const emojiRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)

  // Close emoji picker on click outside
  useEffect(() => {
    if (!emojiOpen) return
    function handleClick(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiOpen(false)
    }
    const id = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handleClick) }
  }, [emojiOpen])

  // Link editing state
  const [linkEditing, setLinkEditing] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [linkPopoverPos, setLinkPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkPopoverRef = useRef<HTMLDivElement>(null)

  // Helper: resolve the full text of a link mark at the current cursor position.
  // If the selection is collapsed inside a link, expand to the full mark range
  // by scanning the parent node's inline children for the matching link mark.
  function getLinkTextAtCursor(ed: NonNullable<typeof editor>) {
    const { from, to } = ed.state.selection
    if (from !== to) {
      return ed.state.doc.textBetween(from, to, '')
    }
    // Selection is collapsed — find the link mark range in the parent node
    const $pos = ed.state.doc.resolve(from)
    const linkMark = $pos.marks().find(m => m.type.name === 'link')
    if (!linkMark) return ''
    const parent = $pos.parent
    const parentStart = $pos.start() // absolute position of parent's first child
    let start = from
    let end = from
    // Iterate the parent's inline children to find the text node(s) with this link mark
    let offset = 0
    parent.forEach((child) => {
      const childStart = parentStart + offset
      const childEnd = childStart + child.nodeSize
      if (child.isText && child.marks.some(m => m.type.name === 'link' && m.attrs.href === linkMark.attrs.href)) {
        // This text node is part of the link
        if (childStart < from && childEnd >= from) {
          // Cursor is inside this node
          start = childStart
          end = childEnd
        } else if (childEnd <= from && childStart >= start) {
          // Before cursor, extend start backward
          start = Math.min(start, childStart)
        } else if (childStart >= from && childStart <= end) {
          // After cursor, extend end forward
          end = Math.max(end, childEnd)
        }
      }
      offset += child.nodeSize
    })
    // Second pass: now that we know the cursor's node, extend to adjacent link nodes
    offset = 0
    parent.forEach((child) => {
      const childStart = parentStart + offset
      const childEnd = childStart + child.nodeSize
      if (child.isText && child.marks.some(m => m.type.name === 'link' && m.attrs.href === linkMark.attrs.href)) {
        if (childStart <= end && childEnd >= start) {
          start = Math.min(start, childStart)
          end = Math.max(end, childEnd)
        }
      }
      offset += child.nodeSize
    })
    return ed.state.doc.textBetween(start, end, '')
  }

  function openLinkEditor(ed: NonNullable<typeof editor>, prefilledText?: string) {
    if (ed.isActive('link')) {
      const attrs = ed.getAttributes('link')
      setLinkUrl(attrs.href ?? '')
      setLinkText(prefilledText ?? getLinkTextAtCursor(ed))
    } else {
      const { from, to } = ed.state.selection
      setLinkText(prefilledText ?? ed.state.doc.textBetween(from, to, ''))
      setLinkUrl('')
    }

    // Position the popover near the link or cursor in the editor.
    // Fall back to the editor element's position if coordsAtPos returns bad values
    // (e.g. when the editor just became editable and has no real selection).
    let pos: { top: number; left: number } | null = null
    try {
      const domAtPos = ed.view.domAtPos(ed.state.selection.from)
      const node = domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement
      const anchor = node?.closest('a') ?? (node?.tagName === 'A' ? node : null)
      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        pos = { top: rect.bottom + 4, left: rect.left }
      } else {
        const coords = ed.view.coordsAtPos(ed.state.selection.from)
        if (coords.bottom > 0 && coords.left > 0) {
          pos = { top: coords.bottom + 4, left: coords.left }
        }
      }
    } catch {
      // domAtPos or coordsAtPos can throw if the view isn't ready
    }
    // Fallback: position below the editor element
    if (!pos) {
      const editorEl = ed.view.dom
      const rect = editorEl.getBoundingClientRect()
      pos = { top: rect.top + 20, left: rect.left + 16 }
    }
    setLinkPopoverPos(pos)
    setLinkEditing(true)
    setTimeout(() => linkInputRef.current?.focus(), 0)
  }

  // Close link popover on click outside
  useEffect(() => {
    if (!linkEditing) return
    function handleClick(e: MouseEvent) {
      if (linkPopoverRef.current && !linkPopoverRef.current.contains(e.target as Node)) {
        setLinkEditing(false)
      }
    }
    // Delay listener to avoid catching the click that opened the popover
    const id = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handleClick) }
  }, [linkEditing])

  function normalizeUrl(url: string): string {
    const trimmed = url.trim()
    if (!trimmed) return trimmed
    // If the URL has no protocol, assume https
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
      return `https://${trimmed}`
    }
    return trimmed
  }

  function applyLink(ed: NonNullable<typeof editor>) {
    const href = normalizeUrl(linkUrl)
    if (!href) { setLinkEditing(false); return }
    if (linkText) {
      ed.chain().focus()
        .extendMarkRange('link')
        .insertContent({ type: 'text', text: linkText, marks: [{ type: 'link', attrs: { href } }] })
        .run()
    } else {
      ed.chain().focus().setLink({ href }).run()
    }
    setLinkEditing(false)
  }

  // Force re-render on every transaction so toolbar buttons reflect
  // the current mark/node state at the cursor position.
  const [, setTxCount] = useState(0)
  const bumpTx = useCallback(() => setTxCount(c => c + 1), [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Link.configure({
        openOnClick: 'whenNotEditable', // click opens link only in read-only mode
        autolink: true,                 // auto-detect URLs as the user types
        HTMLAttributes: {
          class: 'tiptap-link',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      TabHandler,
    ],
    content,
    editable,
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'outline-none max-w-none',
        style: `min-height: ${minHeight}`,
      },
      handleKeyDown(_view, event) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          onSubmitRef.current?.()
          return true
        }
        // Prevent ProseMirror's deleteWordForward from consuming Ctrl+Delete.
        // Returning true skips ProseMirror's keymap but does not stop DOM
        // bubbling, so JournalBlock's onKeyDown wrapper handler still fires.
        if (event.key === 'Delete' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
          return true
        }
        return false
      },
    },
    // Use onTransaction instead of onUpdate so mark-only changes (bold,
    // italic, underline…) are detected.  onUpdate only fires when
    // transaction.docChanged is true, which can be false for stored-mark
    // changes.  Comparing getHTML() covers all meaningful mutations.
    onTransaction({ editor: ed }) {
      bumpTx()
      const html = ed.getHTML()
      if (html !== lastHTMLRef.current) {
        lastHTMLRef.current = html
        onChangeRef.current?.(html, ed.getText())
      }
    },
  })

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() ?? '',
    getText: () => editor?.getText() ?? '',
    clear: () => { editor?.commands.clearContent(true) },
    focus: () => {
      if (!editor) return
      editor.setEditable(true)
      // Use TipTap's own chain which correctly sequences focus then selection.
      // focus('end') internally: establishes DOM focus first, then moves
      // cursor to end and scrolls. This is more reliable than manually
      // calling setTextSelection + view.focus() in sequence.
      editor.chain().focus('end').run()
    },
    focusAtCoords: (x: number, y: number) => {
      if (!editor) return
      editor.setEditable(true)
      const docSize = editor.state.doc.content.size
      const result = editor.view.posAtCoords({ left: x, top: y })
      let resolved = result?.pos ?? null

      // Guard: if resolved to 0 but click wasn't near the top of the editor, discard
      if (resolved === 0) {
        const editorRect = editor.view.dom.getBoundingClientRect()
        if (y > editorRect.top + 20) {
          resolved = null
        }
      }

      // Guard: out of document bounds
      if (resolved !== null && (resolved < 0 || resolved > docSize)) {
        resolved = null
      }

      if (resolved !== null) {
        editor.commands.setTextSelection(resolved)
        editor.view.focus()
      } else {
        editor.commands.setTextSelection(docSize)
        editor.view.focus()
      }
    },
    setContent: (html: string) => {
      if (!editor) return
      lastHTMLRef.current = html
      editor.commands.setContent(html)
      // Re-sync lastHTMLRef after TipTap normalizes the HTML
      lastHTMLRef.current = editor.getHTML()
    },
    openLinkEditor: (prefilledText?: string) => {
      if (!editor) return
      openLinkEditor(editor, prefilledText)
    },
  }), [editor])

  // Notify parent via callback when handle is ready (bypasses next/dynamic ref issues)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  useEffect(() => {
    if (!editor) return
    const handle: TipTapEditorHandle = {
      getHTML: () => editor.getHTML(),
      getText: () => editor.getText(),
      clear: () => editor.commands.clearContent(true),
      focus: () => { editor.setEditable(true); editor.chain().focus('end').run() },
      focusAtCoords: (x: number, y: number) => {
        editor.setEditable(true)
        const docSize = editor.state.doc.content.size
        const result = editor.view.posAtCoords({ left: x, top: y })
        let resolved = result?.pos ?? null
        if (resolved === 0) {
          const editorRect = editor.view.dom.getBoundingClientRect()
          if (y > editorRect.top + 20) resolved = null
        }
        if (resolved !== null && (resolved < 0 || resolved > docSize)) resolved = null
        if (resolved !== null) { editor.commands.setTextSelection(resolved); editor.view.focus() }
        else { editor.commands.setTextSelection(docSize); editor.view.focus() }
      },
      setContent: (html: string) => { lastHTMLRef.current = html; editor.commands.setContent(html); lastHTMLRef.current = editor.getHTML() },
      openLinkEditor: (prefilledText?: string) => openLinkEditor(editor, prefilledText),
    }
    onReadyRef.current?.(handle)
  }, [editor])

  const prevEditableRef = useRef(editable)
  const prevContentRef = useRef(content)

  // useLayoutEffect so editable is set synchronously after render,
  // before paint and before requestAnimationFrame callbacks.
  useLayoutEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  useEffect(() => {
    if (!editor) return
    const wasEditable = prevEditableRef.current
    const contentChanged = content !== prevContentRef.current
    prevEditableRef.current = editable
    prevContentRef.current = content
    if (editable) return  // never overwrite content while user is editing
    // When editable just transitioned from true→false but the content
    // prop hasn't changed, skip the sync to prevent a flash of stale
    // content while the save is in flight. If content DID change in the
    // same render (e.g. AI summarize), apply it immediately.
    if (wasEditable && !contentChanged) return
    if (content === lastHTMLRef.current) return  // nothing changed
    lastHTMLRef.current = content
    editor.commands.setContent(content)
    // Re-sync after TipTap normalizes the HTML
    lastHTMLRef.current = editor.getHTML()
  }, [editor, content, editable])

  const highlightedHTML = useMemo(
    () => (searchHighlight || matchedChunk) && !editable ? highlightHTML(content, searchHighlight || '', matchedChunk) : '',
    [searchHighlight, matchedChunk, editable, content]
  )
  // Only show the highlight layer if it actually contains highlights
  const showHighlightLayer = highlightedHTML.includes('search-highlight') || highlightedHTML.includes('chunk-highlight')

  if (!editor) return null

  return (
    <div className={`tiptap-wrapper relative ${className}`}>
      {toolbarVisible && (
        <div className="flex items-center gap-0.5 px-1.5 py-0.5 border-b border-[#E5E0D0] bg-[#FFFEF7]/50 rounded-t-lg flex-wrap">
          <ToolbarBtn
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <span className="font-bold text-xs">B</span>
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <span className="italic text-xs">I</span>
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline"
          >
            <span className="underline text-xs">U</span>
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <span className="line-through text-xs">S</span>
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('highlight')}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            title="Highlight"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/><line x1="2" y1="20" x2="6" y2="20" stroke="#FBBF24" strokeWidth="3"/></svg>
          </ToolbarBtn>
          <div className="w-px h-4 bg-[#E5E0D0] mx-1" />
          <ToolbarBtn
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet List"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Ordered List"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">1</text><text x="1" y="14" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">2</text><text x="1" y="20" fontSize="7" fill="currentColor" stroke="none" fontFamily="sans-serif">3</text></svg>
          </ToolbarBtn>
          <div className="w-px h-4 bg-[#E5E0D0] mx-1" />
          <ToolbarBtn
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="4" x2="3" y2="20"/><line x1="8" y1="8" x2="20" y2="8"/><line x1="8" y1="12" x2="18" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="Code Block"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </ToolbarBtn>
          <ToolbarBtn
            active={editor.isActive('table')}
            onClick={() => {
              if (editor.isActive('table')) {
                editor.chain().focus().deleteTable().run()
              } else {
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              }
            }}
            title="Insert Table"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
          </ToolbarBtn>
          <ToolbarBtn
            active={false}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </ToolbarBtn>
          <div className="w-px h-4 bg-[#E5E0D0] mx-1" />
          <div className="relative">
            <ToolbarBtn
              active={editor.isActive('link')}
              onClick={() => openLinkEditor(editor)}
              title="Link"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            </ToolbarBtn>
          </div>
          <div className="relative">
            <ToolbarBtn
              active={emojiOpen}
              onClick={() => {
                const rect = emojiButtonRef.current?.getBoundingClientRect()
                if (rect) setEmojiPickerPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                setEmojiOpen(prev => !prev)
              }}
              title="Emoji"
              ref={emojiButtonRef}
            >
              <span className="text-xs leading-none">😀</span>
            </ToolbarBtn>
          </div>
        </div>
      )}
      {/* Read-only highlight layer — shown only when not editing and search is active */}
      {showHighlightLayer && (
        <div
          className="tiptap-content"
          style={{ minHeight }}
          dangerouslySetInnerHTML={{ __html: highlightedHTML }}
        />
      )}

      {/* TipTap editor — hidden (not unmounted) when showing highlight layer */}
      <div style={showHighlightLayer ? { display: 'none' } : undefined}>
        <EditorContent
          editor={editor}
          onContextMenu={(e) => {
            // Right-click on a link opens the link editor
            const target = e.target as HTMLElement
            const anchor = target.closest('a')
            if (anchor && editor.isActive('link')) {
              e.preventDefault()
              openLinkEditor(editor)
            }
          }}
        />
      </div>

      {/* Link editing popover — positioned near the link in the content */}
      {linkEditing && linkPopoverPos && (
        <div
          ref={linkPopoverRef}
          className="fixed z-50 bg-white border border-[#E5E0D0] rounded-lg shadow-xl p-3 min-w-[260px]"
          style={{ top: linkPopoverPos.top, left: linkPopoverPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-0.5">URL</label>
              <input
                ref={linkInputRef}
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://"
                className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded outline-none focus:ring-1 focus:ring-amber-300"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); applyLink(editor) }
                  if (e.key === 'Escape') { setLinkEditing(false); editor.chain().focus().run() }
                }}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Text</label>
              <input
                type="text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder="Link text"
                className="w-full px-2 py-1 text-xs text-gray-900 border border-gray-200 rounded outline-none focus:ring-1 focus:ring-amber-300"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); applyLink(editor) }
                  if (e.key === 'Escape') { setLinkEditing(false); editor.chain().focus().run() }
                }}
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyLink(editor)}
                className="px-2.5 py-1 text-xs text-white bg-gray-900 hover:bg-gray-800 rounded transition-colors"
              >
                Apply
              </button>
              {editor.isActive('link') && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor.chain().focus().unsetLink().run()
                    setLinkEditing(false)
                  }}
                  className="px-2.5 py-1 text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setLinkEditing(false); editor.chain().focus().run() }}
                className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {emojiOpen && emojiPickerPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={emojiRef}
          style={{ position: 'fixed', top: emojiPickerPos.top, right: emojiPickerPos.right, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Suspense fallback={<div className="bg-white border border-[#E5E0D0] rounded-lg shadow-xl p-4 text-xs text-gray-400">Loading...</div>}>
            <EmojiPicker
              data={data}
              onEmojiSelect={(emoji: { native: string }) => {
                editor.chain().focus().insertContent(emoji.native).run()
                setEmojiOpen(false)
              }}
              theme="light"
              previewPosition="none"
              skinTonePosition="search"
              set="native"
            />
          </Suspense>
        </div>,
        document.body
      )}
    </div>
  )
})

const ToolbarBtn = forwardRef<HTMLButtonElement, {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}>(function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${
        active
          ? 'bg-amber-100 text-amber-800'
          : 'text-[#78716C] hover:bg-amber-50 hover:text-amber-800'
      }`}
    >
      {children}
    </button>
  )
})
