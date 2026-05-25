import * as React from 'react'
import type { OutputPreviewSettledHandler } from './OutputInlinePreview'

export type ChartPreviewKind = 'bar' | 'line' | 'pie'

export interface ChartPreviewPoint {
  label: string
  value: number
}

export interface ChartPreviewSpec {
  type: ChartPreviewKind
  title?: string
  xLabel?: string
  yLabel?: string
  data: ChartPreviewPoint[]
}

interface OutputChartPreviewProps {
  content: string
  label: string
  className?: string
  onPreviewSettled?: OutputPreviewSettledHandler
}

const CHART_COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316']
const WIDTH = 820
const HEIGHT = 460
const PLOT = { left: 72, right: 32, top: 56, bottom: 72 }

export function OutputChartPreview({ content, label, className, onPreviewSettled }: OutputChartPreviewProps) {
  const parsed = React.useMemo(() => parseChartPreviewSpec(content), [content])

  React.useEffect(() => {
    onPreviewSettled?.(parsed.ok ? 'ready' : 'error')
  }, [onPreviewSettled, parsed.ok])

  if (!parsed.ok) {
    return (
      <div className={className ?? 'runneros-card flex items-center gap-2 px-3 py-2 text-sm text-white/45'}>
        <span>Chart preview unavailable: {parsed.error}</span>
      </div>
    )
  }

  const spec = parsed.spec
  return (
    <div className={className ?? 'h-full min-h-[360px] w-full overflow-hidden rounded-md'}>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-white/[0.08] bg-black/70">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-3 py-2 text-xs text-white/48">
          <span className="truncate">{spec.title || label}</span>
          <span>{spec.type}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full" role="img" aria-label={spec.title || label}>
            <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="16" fill="#050505" />
            <text x="28" y="34" fill="#d8d8df" fontSize="20" fontWeight="600">{spec.title || label}</text>
            {spec.type === 'pie' ? <PieChart spec={spec} /> : <CartesianChart spec={spec} />}
          </svg>
        </div>
      </div>
    </div>
  )
}

export function parseChartPreviewSpec(content: string): { ok: true; spec: ChartPreviewSpec } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }

  const record = isRecord(raw) ? raw : null
  if (!record) return { ok: false, error: 'chart spec must be an object' }

  const direct = parseDirectChartSpec(record)
  if (direct) return { ok: true, spec: direct }

  const vegaLite = parseVegaLiteLikeSpec(record)
  if (vegaLite) return { ok: true, spec: vegaLite }

  return { ok: false, error: 'expected { type, data } or simple Vega-Lite values' }
}

function parseDirectChartSpec(record: Record<string, unknown>): ChartPreviewSpec | null {
  const type = normalizeChartType(record.type)
  const points = parsePointArray(record.data)
  if (!type || points.length === 0) return null
  return {
    type,
    title: asString(record.title),
    xLabel: asString(record.xLabel),
    yLabel: asString(record.yLabel),
    data: points,
  }
}

function parseVegaLiteLikeSpec(record: Record<string, unknown>): ChartPreviewSpec | null {
  const dataRecord = isRecord(record.data) ? record.data : null
  const values = Array.isArray(dataRecord?.values) ? dataRecord.values : null
  const encoding = isRecord(record.encoding) ? record.encoding : null
  const xField = isRecord(encoding?.x) ? asString(encoding.x.field) : undefined
  const yField = isRecord(encoding?.y) ? asString(encoding.y.field) : undefined
  if (!values || !xField || !yField) return null

  const type = normalizeChartType(isRecord(record.mark) ? record.mark.type : record.mark)
  if (!type) return null

  const points = values.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const value = Number(entry[yField])
    if (!Number.isFinite(value)) return []
    return [{ label: String(entry[xField] ?? ''), value }]
  })
  if (points.length === 0) return null

  return {
    type,
    title: asString(record.title),
    xLabel: xField,
    yLabel: yField,
    data: points,
  }
}

function parsePointArray(value: unknown): ChartPreviewPoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return []
    const rawValue = Number(entry.value)
    if (!Number.isFinite(rawValue)) return []
    return [{
      label: String(entry.label ?? entry.name ?? entry.x ?? index + 1),
      value: rawValue,
    }]
  })
}

function normalizeChartType(value: unknown): ChartPreviewKind | null {
  const type = typeof value === 'string' ? value.toLowerCase() : ''
  if (type === 'bar' || type === 'line' || type === 'pie') return type
  if (type === 'arc') return 'pie'
  return null
}

function CartesianChart({ spec }: { spec: ChartPreviewSpec }) {
  const plotWidth = WIDTH - PLOT.left - PLOT.right
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom
  const max = Math.max(...spec.data.map((point) => point.value), 1)
  const min = Math.min(0, ...spec.data.map((point) => point.value))
  const range = Math.max(max - min, 1)
  const zeroY = PLOT.top + ((max - 0) / range) * plotHeight

  return (
    <g>
      <Axis plotWidth={plotWidth} plotHeight={plotHeight} min={min} max={max} spec={spec} />
      {spec.type === 'bar' ? (
        <BarSeries spec={spec} plotWidth={plotWidth} plotHeight={plotHeight} min={min} max={max} zeroY={zeroY} />
      ) : (
        <LineSeries spec={spec} plotWidth={plotWidth} plotHeight={plotHeight} min={min} max={max} />
      )}
    </g>
  )
}

function Axis({ plotWidth, plotHeight, min, max, spec }: { plotWidth: number; plotHeight: number; min: number; max: number; spec: ChartPreviewSpec }) {
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4)
  return (
    <g>
      <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.top + plotHeight} stroke="#3f3f46" />
      <line x1={PLOT.left} y1={PLOT.top + plotHeight} x2={PLOT.left + plotWidth} y2={PLOT.top + plotHeight} stroke="#3f3f46" />
      {ticks.map((tick) => {
        const y = scaleY(tick, min, max, plotHeight)
        return (
          <g key={tick}>
            <line x1={PLOT.left} y1={y} x2={PLOT.left + plotWidth} y2={y} stroke="#27272a" />
            <text x={PLOT.left - 10} y={y + 4} fill="#a1a1aa" fontSize="11" textAnchor="end">{formatNumber(tick)}</text>
          </g>
        )
      })}
      {spec.xLabel ? <text x={PLOT.left + plotWidth / 2} y={HEIGHT - 18} fill="#a1a1aa" fontSize="12" textAnchor="middle">{spec.xLabel}</text> : null}
      {spec.yLabel ? <text x="20" y={PLOT.top + plotHeight / 2} fill="#a1a1aa" fontSize="12" textAnchor="middle" transform={`rotate(-90 20 ${PLOT.top + plotHeight / 2})`}>{spec.yLabel}</text> : null}
    </g>
  )
}

function BarSeries({ spec, plotWidth, plotHeight, min, max, zeroY }: { spec: ChartPreviewSpec; plotWidth: number; plotHeight: number; min: number; max: number; zeroY: number }) {
  const slot = plotWidth / Math.max(spec.data.length, 1)
  const barWidth = Math.max(10, slot * 0.62)
  return (
    <g>
      {spec.data.map((point, index) => {
        const x = PLOT.left + slot * index + (slot - barWidth) / 2
        const y = scaleY(point.value, min, max, plotHeight)
        const height = Math.max(1, Math.abs(zeroY - y))
        return (
          <g key={`${point.label}-${index}`}>
            <rect x={x} y={Math.min(y, zeroY)} width={barWidth} height={height} rx="5" fill={CHART_COLORS[index % CHART_COLORS.length]} opacity="0.9" />
            <text x={x + barWidth / 2} y={PLOT.top + plotHeight + 20} fill="#a1a1aa" fontSize="11" textAnchor="middle">{truncateLabel(point.label)}</text>
          </g>
        )
      })}
    </g>
  )
}

function LineSeries({ spec, plotWidth, plotHeight, min, max }: { spec: ChartPreviewSpec; plotWidth: number; plotHeight: number; min: number; max: number }) {
  const step = plotWidth / Math.max(spec.data.length - 1, 1)
  const points = spec.data.map((point, index) => ({
    x: PLOT.left + step * index,
    y: scaleY(point.value, min, max, plotHeight),
    point,
  }))
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  return (
    <g>
      <path d={path} fill="none" stroke="#38bdf8" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(({ x, y, point }, index) => (
        <g key={`${point.label}-${index}`}>
          <circle cx={x} cy={y} r="5" fill="#e0f2fe" stroke="#0284c7" strokeWidth="2" />
          <text x={x} y={PLOT.top + plotHeight + 20} fill="#a1a1aa" fontSize="11" textAnchor="middle">{truncateLabel(point.label)}</text>
        </g>
      ))}
    </g>
  )
}

function PieChart({ spec }: { spec: ChartPreviewSpec }) {
  const total = spec.data.reduce((sum, point) => sum + Math.max(point.value, 0), 0)
  if (total <= 0) {
    return <text x={WIDTH / 2} y={HEIGHT / 2} fill="#a1a1aa" fontSize="14" textAnchor="middle">No positive values to chart</text>
  }

  let current = -Math.PI / 2
  const cx = 330
  const cy = 250
  const r = 136

  return (
    <g>
      {spec.data.map((point, index) => {
        const value = Math.max(point.value, 0)
        const next = current + (value / total) * Math.PI * 2
        const path = describeArc(cx, cy, r, current, next)
        current = next
        return <path key={`${point.label}-${index}`} d={path} fill={CHART_COLORS[index % CHART_COLORS.length]} opacity="0.9" />
      })}
      <g transform="translate(540 132)">
        {spec.data.slice(0, 10).map((point, index) => (
          <g key={`${point.label}-${index}`} transform={`translate(0 ${index * 27})`}>
            <rect x="0" y="-11" width="14" height="14" rx="3" fill={CHART_COLORS[index % CHART_COLORS.length]} />
            <text x="24" y="0" fill="#d4d4d8" fontSize="13">{truncateLabel(point.label, 24)} ({formatNumber(point.value)})</text>
          </g>
        ))}
      </g>
    </g>
  )
}

function scaleY(value: number, min: number, max: number, plotHeight: number): number {
  const range = Math.max(max - min, 1)
  return PLOT.top + ((max - value) / range) * plotHeight
}

function describeArc(cx: number, cy: number, r: number, start: number, end: number): string {
  const startPoint = polarToCartesian(cx, cy, r, end)
  const endPoint = polarToCartesian(cx, cy, r, start)
  const largeArc = end - start <= Math.PI ? 0 : 1
  return `M ${cx} ${cy} L ${startPoint.x} ${startPoint.y} A ${r} ${r} 0 ${largeArc} 0 ${endPoint.x} ${endPoint.y} Z`
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  }
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function truncateLabel(value: string, max = 12): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}...` : value
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
