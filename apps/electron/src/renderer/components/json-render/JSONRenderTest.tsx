/**
 * JSONRenderTest - Quick test component to verify json-render works
 *
 * Import this in a page to test: import { JSONRenderTest } from '@/components/json-render/JSONRenderTest'
 */

import { JSONRenderView } from './JSONRenderView'
import type { UITree } from './JSONRenderView'

// Test tree with all components including new data visualization
const testTree: UITree = {
  root: 'mainStack',
  elements: {
    'mainStack': {
      type: 'Stack',
      props: { direction: 'vertical', gap: 'lg' },
      children: ['metricsCard', 'chartCard', 'dataTableCard', 'interactiveCard'],
    },
    // Metrics Card
    'metricsCard': {
      type: 'Card',
      props: { title: 'Key Metrics', description: 'Real-time KPIs' },
      children: ['metricsRow'],
    },
    'metricsRow': {
      type: 'Stack',
      props: { direction: 'horizontal', gap: 'md' },
      children: ['metric1', 'metric2', 'metric3'],
    },
    'metric1': {
      type: 'Metric',
      props: { label: 'Revenue', value: 125000, prefix: '$', trend: 'up', change: '+12%' },
    },
    'metric2': {
      type: 'Metric',
      props: { label: 'Users', value: 5432, trend: 'up', change: '+8%' },
    },
    'metric3': {
      type: 'Metric',
      props: { label: 'Bounce Rate', value: 32.5, suffix: '%', trend: 'down', change: '-3%' },
    },
    // Chart Card
    'chartCard': {
      type: 'Card',
      props: { title: 'Sales by Month', description: 'Interactive bar chart' },
      children: ['chart1'],
    },
    'chart1': {
      type: 'Chart',
      props: {
        type: 'bar',
        data: [
          { month: 'Jan', sales: 4000 },
          { month: 'Feb', sales: 5500 },
          { month: 'Mar', sales: 4800 },
          { month: 'Apr', sales: 6200 },
          { month: 'May', sales: 7100 },
          { month: 'Jun', sales: 8500 },
        ],
        xKey: 'month',
        yKey: 'sales',
        height: 250,
        colors: ['#8884d8'],
      },
    },
    // DataTable Card
    'dataTableCard': {
      type: 'Card',
      props: { title: 'Recent Orders', description: 'Sortable and filterable table' },
      children: ['dataTable1'],
    },
    'dataTable1': {
      type: 'DataTable',
      props: {
        columns: [
          { key: 'id', header: 'Order ID', sortable: true },
          { key: 'customer', header: 'Customer', sortable: true },
          { key: 'total', header: 'Total', sortable: true },
          { key: 'status', header: 'Status', sortable: true },
        ],
        data: [
          { id: 'ORD-001', customer: 'Alice Smith', total: '$250.00', status: 'Completed' },
          { id: 'ORD-002', customer: 'Bob Johnson', total: '$180.50', status: 'Pending' },
          { id: 'ORD-003', customer: 'Carol White', total: '$320.00', status: 'Completed' },
          { id: 'ORD-004', customer: 'David Brown', total: '$95.00', status: 'Cancelled' },
          { id: 'ORD-005', customer: 'Eve Davis', total: '$450.00', status: 'Shipped' },
        ],
        searchable: true,
        pageSize: 5,
      },
    },
    // Interactive Card
    'interactiveCard': {
      type: 'Card',
      props: { title: 'Interactive Components', description: 'Buttons, inputs, and actions' },
      children: ['interactiveStack'],
    },
    'interactiveStack': {
      type: 'Stack',
      props: { direction: 'vertical', gap: 'md' },
      children: ['buttonRow', 'inputRow', 'badge1'],
    },
    'buttonRow': {
      type: 'Stack',
      props: { direction: 'horizontal', gap: 'sm' },
      children: ['btn1', 'btn2', 'btn3', 'btn4'],
    },
    'btn1': {
      type: 'Button',
      props: { label: 'Copy Text', variant: 'default', action: { name: 'copy', params: { text: 'Hello from JSONRender!' } } },
    },
    'btn2': {
      type: 'Button',
      props: { label: 'Open Link', variant: 'secondary', action: { name: 'open_url', params: { url: 'https://github.com' } } },
    },
    'btn3': {
      type: 'Button',
      props: { label: 'Log Data', variant: 'outline', action: 'log' },
    },
    'btn4': {
      type: 'Button',
      props: { label: 'API Call', variant: 'ghost', action: { name: 'api_call', params: { url: 'https://jsonplaceholder.typicode.com/posts/1', method: 'GET' } } },
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
      props: { label: 'All Components Working!', variant: 'default' },
    },
  },
}

export function JSONRenderTest() {
  console.log('[JSONRenderTest] Rendering with full component test')

  const handleAction = (actionName: string, params?: Record<string, unknown>) => {
    console.log('[JSONRenderTest] Action triggered:', actionName, params)
  }

  return (
    <div className="p-4 border rounded-lg max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-4">JSON Render Full Component Test</h2>
      <div className="bg-muted/30 p-4 rounded">
        <JSONRenderView
          tree={testTree}
          initialData={{ user: { name: '', color: '' } }}
          onAction={handleAction}
        />
      </div>
    </div>
  )
}
