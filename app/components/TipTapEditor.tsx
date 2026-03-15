'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Placeholder from '@tiptap/extension-placeholder'
import { Extension } from '@tiptap/core'
import { useState, useEffect, useLayoutEffect, useImperativeHandle, useRef, forwardRef, useCallback } from 'react'

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
}

export const TipTapEditor = forwardRef<TipTapEditorHandle, Props>(function TipTapEditor(
  { content = '', placeholder, autoFocus, onSubmit, onChange, className = '', minHeight = '0', editable = true, toolbarVisible = false },
  ref
) {
  // Keep refs so the closures inside useEditor always call the latest callbacks
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastHTMLRef = useRef(content)

  // Force re-render on every transaction so toolbar buttons reflect
  // the current mark/node state at the cursor position.
  const [, setTxCount] = useState(0)
  const bumpTx = useCallback(() => setTxCount(c => c + 1), [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
      }),
      Underline,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
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
  }), [editor])

  // useLayoutEffect so editable is set synchronously after render,
  // before paint and before requestAnimationFrame callbacks.
  useLayoutEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  useEffect(() => {
    if (!editor) return
    if (editable) return  // never overwrite content while user is editing
    if (content === lastHTMLRef.current) return  // nothing changed
    lastHTMLRef.current = content
    editor.commands.setContent(content)
    // Re-sync after TipTap normalizes the HTML
    lastHTMLRef.current = editor.getHTML()
  }, [editor, content, editable])

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
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
})

function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
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
}
