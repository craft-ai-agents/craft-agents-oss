import { describe, expect, it } from 'bun:test'
import { normalizeAccountServerUrl } from '../account-server-url'

describe('normalizeAccountServerUrl', () => {
  it('accepts and normalizes public HTTPS origins', () => {
    expect(normalizeAccountServerUrl(' https://accounts.example.com/ ')).toBe('https://accounts.example.com')
    expect(normalizeAccountServerUrl('https://accounts.example.com:9443')).toBe('https://accounts.example.com:9443')
  })

  it('allows HTTP only for exact loopback hosts', () => {
    expect(normalizeAccountServerUrl('http://localhost:9100')).toBe('http://localhost:9100')
    expect(normalizeAccountServerUrl('http://127.0.0.1:9100/')).toBe('http://127.0.0.1:9100')
    expect(normalizeAccountServerUrl('http://[::1]:9100')).toBe('http://[::1]:9100')
  })

  it('rejects public and private-network HTTP addresses', () => {
    for (const value of [
      'http://accounts.example.com',
      'http://203.0.113.10:9100',
      'http://10.0.0.8:9100',
      'http://192.168.1.8:9100',
    ]) {
      expect(() => normalizeAccountServerUrl(value)).toThrow('公网账户服务器必须使用 HTTPS')
    }
  })

  it('rejects credentials, paths, queries, and fragments', () => {
    expect(() => normalizeAccountServerUrl('https://user:pass@example.com')).toThrow('不能包含用户名或密码')
    expect(() => normalizeAccountServerUrl('https://example.com/account')).toThrow('请输入服务器根地址')
    expect(() => normalizeAccountServerUrl('https://example.com?tenant=1')).toThrow('请输入服务器根地址')
    expect(() => normalizeAccountServerUrl('https://example.com/#login')).toThrow('请输入服务器根地址')
  })

  it('rejects invalid and unsupported URLs', () => {
    expect(() => normalizeAccountServerUrl('not a url')).toThrow('请输入有效的账户服务器地址')
    expect(() => normalizeAccountServerUrl('ftp://example.com')).toThrow('公网账户服务器必须使用 HTTPS')
  })
})
