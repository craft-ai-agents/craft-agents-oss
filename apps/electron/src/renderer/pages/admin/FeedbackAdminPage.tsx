/**
 * FeedbackAdminPage
 *
 * Container for feedback list/detail admin views.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeedbackRecord } from '@craft-agent/shared/feedback'
import FeedbackDetailPage from './FeedbackDetailPage'
import FeedbackListPage from './FeedbackListPage'
import type { FeedbackRatingFilter } from './feedback-admin-utils'

export default function FeedbackAdminPage() {
  const [records, setRecords] = useState<FeedbackRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ratingFilter, setRatingFilter] = useState<FeedbackRatingFilter>('dislike')
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)

  const selectedRecord = useMemo(
    () => records.find(record => record.id === selectedRecordId) ?? null,
    [records, selectedRecordId],
  )

  const loadFeedback = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextRecords = await window.electronAPI.listChatFeedback()
      setRecords(nextRecords)
    } catch (err) {
      setError(err instanceof Error ? err.message : '评价数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFeedback()
  }, [loadFeedback])

  useEffect(() => {
    if (selectedRecordId && !records.some(record => record.id === selectedRecordId)) {
      setSelectedRecordId(null)
    }
  }, [records, selectedRecordId])

  if (selectedRecord) {
    return (
      <FeedbackDetailPage
        record={selectedRecord}
        onBack={() => setSelectedRecordId(null)}
      />
    )
  }

  return (
    <FeedbackListPage
      error={error}
      filter={ratingFilter}
      loading={loading}
      records={records}
      onFilterChange={setRatingFilter}
      onOpenRecord={record => setSelectedRecordId(record.id)}
      onRefresh={() => void loadFeedback()}
    />
  )
}
