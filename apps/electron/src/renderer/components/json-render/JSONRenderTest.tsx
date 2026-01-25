/**
 * JSONRenderTest - Quick test component to verify json-render works
 *
 * Import this in a page to test: import { JSONRenderTest } from '@/components/json-render/JSONRenderTest'
 */

import { JSONRenderView } from './JSONRenderView'

// Test tree with interactive components
const testTree = {
  root: 'card1',
  elements: {
    'card1': {
      type: 'Card',
      props: { title: 'Interactive Components Test', description: 'Testing Button, TextField, and SelectField' },
      children: ['stack1'],
    },
    'stack1': {
      type: 'Stack',
      props: { direction: 'vertical', gap: 'md' },
      children: ['text1', 'buttonRow', 'inputRow', 'badge1'],
    },
    'text1': {
      type: 'Text',
      props: { content: 'Click the buttons below to test actions:', variant: 'p' },
    },
    'buttonRow': {
      type: 'Stack',
      props: { direction: 'horizontal', gap: 'sm' },
      children: ['btn1', 'btn2', 'btn3'],
    },
    'btn1': {
      type: 'Button',
      props: { label: 'Copy Text', variant: 'default', action: 'copy' },
    },
    'btn2': {
      type: 'Button',
      props: { label: 'Open Link', variant: 'secondary', action: 'open_url' },
    },
    'btn3': {
      type: 'Button',
      props: { label: 'Log Data', variant: 'outline', action: 'log' },
    },
    'inputRow': {
      type: 'Stack',
      props: { direction: 'horizontal', gap: 'md' },
      children: ['textfield1', 'select1'],
    },
    'textfield1': {
      type: 'TextField',
      props: { label: 'Your Name', valuePath: '/user/name', placeholder: 'Enter your name...' },
    },
    'select1': {
      type: 'SelectField',
      props: {
        label: 'Color',
        bindPath: '/user/color',
        placeholder: 'Pick a color',
        options: [
          { value: 'red', label: 'Red' },
          { value: 'green', label: 'Green' },
          { value: 'blue', label: 'Blue' },
        ],
      },
    },
    'badge1': {
      type: 'Badge',
      props: { label: 'Interactive', variant: 'default' },
    },
  },
}

export function JSONRenderTest() {
  console.log('[JSONRenderTest] Rendering with interactive tree')

  const handleAction = (actionName: string, params?: Record<string, unknown>) => {
    console.log('[JSONRenderTest] Action triggered:', actionName, params)
    alert(`Action: ${actionName}\nParams: ${JSON.stringify(params || {})}`)
  }

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-lg font-bold mb-4">JSON Render Interactive Test</h2>
      <div className="bg-muted/30 p-4 rounded">
        <JSONRenderView
          tree={testTree}
          initialData={{ user: { name: '', color: '' } }}
          onAction={handleAction}
          actionHandlers={{
            copy: async () => {
              await navigator.clipboard.writeText('Hello from JSONRender!')
              alert('Copied "Hello from JSONRender!" to clipboard')
            },
            open_url: async () => {
              window.open('https://json-render.org', '_blank')
            },
            log: async () => {
              console.log('[JSONRenderTest] Log action executed')
            },
          }}
        />
      </div>
    </div>
  )
}
