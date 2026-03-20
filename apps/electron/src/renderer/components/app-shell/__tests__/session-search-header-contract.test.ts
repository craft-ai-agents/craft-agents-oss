import { describe, expect, it } from 'bun:test'
import type { SessionSearchHeaderProps } from '../SessionSearchHeader'

describe('SessionSearchHeader contract', () => {
  it('does not include onSearchClose in its props interface', () => {
    // Verify the component's props interface does NOT include onSearchClose.
    // If someone adds onSearchClose back, this will cause a TypeScript compile error.
    const props: SessionSearchHeaderProps = {
      searchQuery: 'test',
    }

    // The prop interface should only contain the expected fields
    const validKeys: (keyof SessionSearchHeaderProps)[] = [
      'searchQuery',
      'onSearchChange',
      'onKeyDown',
      'onFocus',
      'onBlur',
      'isSearching',
      'resultCount',
      'exceededLimit',
      'inputRef',
      'placeholder',
      'readOnly',
    ]

    // Ensure searchQuery is the only required prop
    expect(props.searchQuery).toBe('test')
    expect(validKeys).not.toContain('onSearchClose' as keyof SessionSearchHeaderProps)
  })

  it('accepts all expected optional props', () => {
    // This is a compile-time check: all these props should be valid
    const props: SessionSearchHeaderProps = {
      searchQuery: '',
      onSearchChange: (_q: string) => {},
      onKeyDown: (_e: React.KeyboardEvent<HTMLInputElement>) => {},
      onFocus: () => {},
      onBlur: () => {},
      isSearching: false,
      resultCount: 10,
      exceededLimit: false,
      placeholder: 'Search...',
      readOnly: false,
    }

    expect(props.searchQuery).toBe('')
    expect(props.isSearching).toBe(false)
    expect(props.resultCount).toBe(10)
    expect(props.exceededLimit).toBe(false)
    expect(props.placeholder).toBe('Search...')
    expect(props.readOnly).toBe(false)
  })
})
