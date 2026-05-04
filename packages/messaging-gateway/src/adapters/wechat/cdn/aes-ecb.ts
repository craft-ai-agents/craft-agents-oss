/**
 * Shared AES-128-ECB primitives used by the WeChat CDN upload/download paths.
 *
 * iLink encrypts every media blob (image, voice, video, file) with a
 * per-message AES-128 key — sent over the bot channel as a hex string in
 * `image_item.aeskey` / base64 in `media.aes_key`. Both the encryption
 * (outbound upload) and decryption (inbound download) use ECB with PKCS7
 * padding; we never need IVs.
 *
 * ---------------------------------------------------------------------------
 * Ported verbatim from openclaw-weixin (https://github.com/Tencent/openclaw-weixin),
 * Copyright (C) 2026 Tencent, MIT-licensed. See repository NOTICE.
 * ---------------------------------------------------------------------------
 */

import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv } from 'node:crypto'

/** Encrypt with AES-128-ECB + PKCS7 padding (Node default). */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

/** Decrypt AES-128-ECB ciphertext (PKCS7 padding). */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Predict the ciphertext size for a plaintext of the given length under
 * AES-128-ECB + PKCS7 padding. Required by `getuploadurl` which must be
 * called with the *encrypted* file size before the actual upload.
 */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16
}
